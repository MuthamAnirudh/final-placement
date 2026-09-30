"""
AI Mock Interviewer — video behavioral indicators (spec §10 "Video: posture, gaze/engagement
indicators").

CRITICAL ethical constraint from the spec, enforced throughout this file: these are
BEHAVIORAL INDICATORS ONLY. Nothing here claims to measure intelligence, honesty,
personality, mental state, or competence — every field name and the `caveats` list say so
explicitly, and none of these numbers are merged into the interview_nlp.py competency
rubric (see the multimodal-fusion note in interview_nlp.py).

Implementation (a legitimate, documented baseline per spec §33 — replaceable with a more
sophisticated model later without changing this module's response shape): OpenCV's built-in
Haar-cascade face/eye detectors. Deliberately NOT MediaPipe Face Mesh here — MediaPipe's
current Tasks API requires downloading a separate .task model bundle at runtime (no bundled
weights, unlike the older `solutions` API it replaces), which would make this feature
silently depend on network access at inference time; Haar cascades ship inside opencv-python
itself (cv2.data.haarcascades), so this works fully offline with zero extra downloads. If a
deployment wants MediaPipe/dlib-quality landmarks instead, swap `_detect_face_and_eyes`
below — the public `analyze_video_behavior()` response shape is designed to stay stable.

  - face presence: Haar frontal-face detector per sampled frame -> % of frames with a
    detected face ("on camera" ratio, not an attentiveness score).
  - posture/movement stability: variance of the face bounding-box center across frames,
    normalized by frame size (a lot of movement/repositioning vs. a stable frame).
  - rough gaze/eye-orientation: Haar eye detector inside the face ROI -> horizontal offset of
    the detected eye midpoint from the face's horizontal center. A coarse geometric proxy for
    "facing the camera vs. turned to a side", explicitly NOT validated gaze-tracking.

Degrades honestly: if opencv-python isn't installed, the cascade files can't be loaded, or
the video can't be decoded, this returns `available: False` with a plain reason — never a
fabricated score.
"""
import math
import os
import statistics
import tempfile
from typing import Iterator, Optional

from app.config import get_settings
from app.services._util import safe_suffix

try:
    import cv2
    _CV2_OK = True
except ImportError:
    _CV2_OK = False

_settings = get_settings()
MAX_FRAME_WIDTH = 480  # frames are downscaled to this width before detection (Haar works fine at this size)

SAMPLE_FPS = 2.0  # analyze ~2 frames/sec — enough signal for a 1-3 minute interview answer without heavy CPU cost
EYE_CENTER_TOLERANCE = 0.15  # fraction of face width the eye midpoint may drift from center and still count as "toward camera"


class VideoUnavailable(Exception):
    pass


def _write_temp(content: bytes, filename: str) -> str:
    suffix = safe_suffix(filename, ".webm")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(content)
        return f.name


def _sample_frames(video_path: str, sample_fps: float) -> Iterator:
    """Yields downscaled sampled frames one at a time.

    FIX (memory): this used to decode EVERY sampled frame at full resolution into one list before analysis
    (a 5-minute 720p answer = ~600 frames x 2.7 MB = ~1.6 GB), which the 512 MB free tier cannot survive
    (the process is OOM-killed and the portal reports "AI/ML service not responding"). Frames are now streamed,
    downscaled, and capped at ANALYSIS_MAX_VIDEO_FRAMES.

    FIX (fps): browser MediaRecorder WebM files usually report a bogus FPS (0, nan, 1000 or 90000). That made
    `step` huge and only one frame was ever sampled. Implausible values now fall back to 30 fps.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        raise VideoUnavailable("Could not open/decode this video file.")
    try:
        native_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        if not (isinstance(native_fps, (int, float)) and math.isfinite(native_fps) and 1.0 <= native_fps <= 120.0):
            native_fps = 30.0
        step = max(1, round(native_fps / sample_fps))
        max_frames = max(1, _settings.ANALYSIS_MAX_VIDEO_FRAMES)
        i = yielded = 0
        while yielded < max_frames:
            if i % step != 0:
                if not cap.grab():  # cheap skip: advance without decoding/copying the frame
                    break
                i += 1
                continue
            ok, frame = cap.read()
            if not ok:
                break
            i += 1
            h, w = frame.shape[:2]
            if w > MAX_FRAME_WIDTH:
                scale = MAX_FRAME_WIDTH / float(w)
                frame = cv2.resize(frame, (MAX_FRAME_WIDTH, max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
            yielded += 1
            yield frame
    finally:
        cap.release()


_face_cascade = None
_eye_cascade = None


def _load_cascades():
    global _face_cascade, _eye_cascade
    if _face_cascade is None:
        face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        eye = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
        # FIX: a missing/corrupt cascade file gives an EMPTY classifier that silently detects nothing, which
        # would have been reported as "0% face presence" (a fabricated result). Fail honestly instead.
        if face.empty() or eye.empty():
            raise VideoUnavailable("OpenCV Haar-cascade model files could not be loaded on this deployment.")
        _face_cascade, _eye_cascade = face, eye
    return _face_cascade, _eye_cascade


def _detect_face_and_eyes(gray_frame) -> Optional[dict]:
    face_cascade, eye_cascade = _load_cascades()
    faces = face_cascade.detectMultiScale(gray_frame, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(faces) == 0:
        return None
    # Largest detected face = the interview candidate (assume single-person frame).
    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    face_roi = gray_frame[fy:fy + fh, fx:fx + fw]
    eyes = eye_cascade.detectMultiScale(face_roi, scaleFactor=1.1, minNeighbors=5, minSize=(15, 15))
    eye_center_offset = None
    if len(eyes) > 0:
        eye_centers_x = [(ex + ew / 2) for ex, ey, ew, eh in eyes]
        avg_eye_x = sum(eye_centers_x) / len(eye_centers_x)
        eye_center_offset = abs((avg_eye_x / fw) - 0.5)  # 0 = perfectly centered horizontally
    return {"bbox_center": (fx + fw / 2, fy + fh / 2), "eyes_detected": len(eyes), "eye_center_offset": eye_center_offset}


def analyze_video_behavior(content: bytes, filename: str, sample_fps: float = SAMPLE_FPS) -> dict:
    if not _CV2_OK:
        return {"available": False, "reason": "Required package 'opencv-python' is not installed on this deployment."}

    video_path = None
    try:
        video_path = _write_temp(content, filename)

        face_centers = []
        eye_offsets = []
        frames_with_face = 0
        total_frames = 0

        try:
            for frame in _sample_frames(video_path, sample_fps):
                total_frames += 1
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                detection = _detect_face_and_eyes(gray)
                if detection is None:
                    continue
                frames_with_face += 1
                h, w = frame.shape[:2]
                cx, cy = detection["bbox_center"]
                face_centers.append((cx / w, cy / h))
                if detection["eye_center_offset"] is not None:
                    eye_offsets.append(detection["eye_center_offset"])
        except VideoUnavailable as exc:
            return {"available": False, "reason": str(exc)}
        except cv2.error as exc:
            return {"available": False, "reason": f"OpenCV could not process this video ({exc})."}

        if total_frames == 0:
            return {"available": False, "reason": "No frames could be read from this video."}

        face_presence_ratio = round(frames_with_face / total_frames, 3)

        posture_stability_score = None
        movement_note = None
        if len(face_centers) >= 2:
            xs = [c[0] for c in face_centers]
            ys = [c[1] for c in face_centers]
            movement_std = (statistics.pstdev(xs) ** 2 + statistics.pstdev(ys) ** 2) ** 0.5
            # Normalized wobble of the face's on-screen position across the clip — a proxy for
            # how much the candidate shifted/repositioned, not a posture-quality judgment.
            posture_stability_score = round(max(0.0, 1.0 - min(1.0, movement_std * 10)), 3)
            movement_note = (
                "Frequent repositioning detected during this answer." if movement_std > 0.05
                else "Position stayed fairly consistent during this answer."
            )

        gaze_toward_camera_ratio = None
        if eye_offsets:
            on_target = sum(1 for o in eye_offsets if o <= EYE_CENTER_TOLERANCE)
            gaze_toward_camera_ratio = round(on_target / len(eye_offsets), 3)

        return {
            "available": True,
            "frames_sampled": total_frames,
            "frames_with_face_detected": frames_with_face,
            "face_presence_ratio": face_presence_ratio,
            "posture_stability_score": posture_stability_score,
            "movement_note": movement_note,
            "gaze_toward_camera_ratio": gaze_toward_camera_ratio,
            "method": "OpenCV Haar-cascade face/eye detection per sampled frame (~2fps, largest "
                      "detected face used). face_presence_ratio = fraction of sampled frames with "
                      "a detected face. posture_stability_score = 1 minus the normalized variance "
                      "of the face's on-screen position. gaze_toward_camera_ratio = fraction of "
                      "frames where the detected eye midpoint is horizontally close to the face's "
                      "center. All are coarse geometric heuristics from a classical (non-learned) "
                      "detector, not validated gaze-tracking or posture-grading research.",
            "caveats": [
                "These are behavioral indicators only — camera framing, lighting, webcam "
                "angle, glasses, and hair can all affect them independently of the candidate's "
                "actual engagement.",
                "This does NOT measure intelligence, honesty, personality, mental state, or "
                "competence, and must never be presented to a candidate or evaluator as if it did.",
                "Haar-cascade detection can miss faces at extreme angles or in poor lighting — "
                "a low face_presence_ratio may reflect webcam conditions, not candidate behavior.",
            ],
        }
    finally:
        if video_path and os.path.exists(video_path):
            os.unlink(video_path)
