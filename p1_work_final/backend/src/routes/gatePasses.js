const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const redeemLimiter = rateLimit({windowMs:60*1000,max:Number(process.env.GATE_REDEEM_RATE_LIMIT_PER_MINUTE||60),standardHeaders:true,legacyHeaders:false,message:{status:'rate_limited',message:'Too many gate-pass verification attempts. Please try again shortly.'}});
// The 30-second rule is the maximum time allowed for the verification request to
// complete after a QR is scanned. It is NOT a 30-second lifetime from QR generation.
// A newly approved QR remains scannable until its first successful redemption; the
// atomic qrUsed flag then expires it globally immediately.

function newQrToken() { return crypto.randomBytes(32).toString('base64url'); }

// The QR is valid from the student's explicitly requested out-date/out-time until
// exactly 3 hours after that mentioned departure time. This is separate from the
// 30-second network-verification window: 30 seconds is only the maximum time allowed
// for the server to finish a scan after the QR is actually scanned.
function gatePassExpiryFromOutTime(data) {
  // Safety net: if the out date/time is missing or malformed, the QR must still not live forever,
  // so it falls back to 3 hours after approval instead of having no deadline at all.
  const fallback = () => new Date(Date.now() + 3 * 60 * 60 * 1000);
  const outDate = String(data?.outDate || '').trim();
  const outTime = String(data?.outTime || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(outDate) || !/^\d{2}:\d{2}$/.test(outTime)) return fallback();
  const [y,m,d] = outDate.split('-').map(Number);
  const [hh,mm] = outTime.split(':').map(Number);
  if (![y,m,d,hh,mm].every(Number.isFinite) || hh > 23 || mm > 59) return fallback();
  // Gate-pass times are entered as campus/local India time. Build the instant
  // explicitly as IST (+05:30), so the server's own timezone cannot change the rule.
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - (5 * 60 + 30) * 60 * 1000 + 3 * 60 * 60 * 1000;
  const result = new Date(utcMs);
  return Number.isNaN(result.getTime()) ? fallback() : result;
}

function idOf(v) {
  try { return BigInt(String(v)); } catch (_) { return null; }
}
function jsonPass(row) {
  if (!row) return null;
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  return { ...data, id: Number(row.id), status: row.status, studentEmail: row.studentEmail, qrToken: row.qrToken, qrUsed: row.qrUsed, qrUsedAt: row.qrUsedAt || data.qrUsedAt || null, expiresAt: row.expiresAt || data.expiresAt || null };
}
function canAccessPass(req,row){
  const role=String(req.user?.role||'').toUpperCase(), email=String(req.user?.email||'').toLowerCase();
  if(role==='ADMIN') return true;
  if(!req.user) return false;
  if(role==='STUDENT'||role==='COORDINATOR') return String(row.studentEmail||'').toLowerCase()===email;
  const data=row.data&&typeof row.data==='object'?row.data:{};
  if(role==='TEACHER') return [data.classTeacherEmail,data.teacherEmail,data.approverEmail].some(v=>String(v||'').toLowerCase()===email);
  if(role==='MENTOR') return [data.mentorEmail,data.approverEmail].some(v=>String(v||'').toLowerCase()===email);
  return false;
}

function normalizeBranch(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
const BRANCH_ALIASES = {
  cse:'computer science engineering', cs:'computer science engineering',
  'cs&e':'computer science engineering', 'comp sci':'computer science engineering',
  ise:'information science engineering', is:'information science engineering',
  ece:'ece/eee', eee:'ece/eee', ec:'ece/eee',
  mech:'mechanical', me:'mechanical', 'civil eng':'civil', ce:'civil',
  aiml:'artificial intelligence & machine learning', 'ai&ml':'artificial intelligence & machine learning',
  'ai/ml':'artificial intelligence & machine learning', 'ai ml':'artificial intelligence & machine learning',
  ds:'data science engineering', dse:'data science engineering'
};
function branchesMatch(a,b) {
  const aa=normalizeBranch(a), bb=normalizeBranch(b);
  if(!aa || !bb) return false;
  return (BRANCH_ALIASES[aa] || aa) === (BRANCH_ALIASES[bb] || bb);
}
async function facultyCanModifyPass(req,row) {
  const role=String(req.user?.role||'').toUpperCase();
  if(role!=='TEACHER' && role!=='MENTOR') return false;
  const email=String(req.user?.email||'').trim().toLowerCase();
  const data=row?.data && typeof row.data==='object' ? row.data : {};
  const mapped=String((role==='TEACHER' ? data.classTeacherEmail : data.mentorEmail) || '').trim().toLowerCase();
  if(mapped && mapped===email) return true;
  // Branch fallback is intentional: the frontend routes orphaned/unmapped requests
  // to an active faculty member of the same branch. Authorize that same fallback here.
  if(mapped) {
    const mappedUser=await prisma.user.findUnique({where:{email:mapped},select:{id:true,role:true}});
    if(mappedUser && String(mappedUser.role).toUpperCase()===role) return false;
  }
  const me=await prisma.user.findUnique({where:{id:String(req.user.sub)},select:{branch:true,role:true,email:true}});
  return !!me && String(me.role).toUpperCase()===role && branchesMatch(data.branch,me.branch);
}

// Fields only the server-side workflow endpoints (faculty / guardian / HOD / redeem) may change.
const SERVER_CONTROLLED_KEYS = ['status','stage','qrToken','qrUsed','qrUsedAt','expiresAt',
  'teacherStatus','mentorStatus','guardianStatus','guardianApprovalMethod','guardianConfirmedBy',
  'guardianDecidedAt','guardianToken','decidedAt','decidedBy','hodRemarks','hodSignature',
  'rejectedStage','rejectedBy','teacherDecidedBy','teacherDecidedAt','mentorDecidedBy','mentorDecidedAt',
  'teacherRemarks','mentorRemarks','guardianRemarks','rejectedRemarks','guardianNotifiedVia',
  'qrValidUntil','hodOverride','hodOverrideStage','hodOverrideAt'];
function isStudentLike(req){ const r=String(req.user?.role||'').toUpperCase(); return r==='STUDENT'||r==='COORDINATOR'; }
// Students/coordinators may edit their own request details but never the approval state.
function sanitizeStudentPass(req, pass, existing) {
  if(!isStudentLike(req)) return pass;
  const clean={...pass};
  const own=String(req.user?.email||'').toLowerCase();
  clean.studentEmail=own; delete clean.email;
  if(existing) {
    const old=existing.data && typeof existing.data==='object' ? existing.data : {};
    for(const k of SERVER_CONTROLLED_KEYS) { if(k in old) clean[k]=old[k]; else delete clean[k]; }
    clean.status=existing.status; clean.qrToken=existing.qrToken; clean.qrUsed=!!existing.qrUsed;
  } else {
    clean.status='pending'; clean.qrUsed=false; clean.qrUsedAt=null; delete clean.qrToken; delete clean.hodSignature;
    delete clean.decidedAt; delete clean.decidedBy; delete clean.expiresAt;
  }
  return clean;
}

function safePublic(row) {
  if (!row) return null;
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  return {
    id: Number(row.id),
    status: row.status,
    studentName: data.studentName || null,
    rollNo: data.rollNo || null,
    branch: data.branch || null,
    destination: data.destination || null,
    reason: data.reason || null,
    outDate: data.outDate || null,
    outTime: data.outTime || null,
    returnDate: data.returnDate || null,
    returnTime: data.returnTime || null,
    decidedBy: data.decidedBy || null,
    decidedAt: data.decidedAt || null,
    qrUsedAt: row.qrUsedAt || data.qrUsedAt || null,
    expiresAt: row.expiresAt || data.expiresAt || null,
    // Do not expose biometric/photo/signature blobs from an unauthenticated QR endpoint.
    // The authenticated pass endpoint remains the source for the full student-owned record.
  };
}

router.get('/', requireAuth, async (req,res) => {
  try {
    const isStudent=String(req.user.role||'').toUpperCase()==='STUDENT';
    const rows = await prisma.gatePass.findMany({
      where: isStudent ? { studentEmail: String(req.user.email||'').toLowerCase() } : undefined,
      orderBy: { id: 'desc' }, take: Math.min(Math.max(Number(req.query.limit||500),1),1000)
    });
    res.json({ data: rows.filter(r=>canAccessPass(req,r)).map(jsonPass) });
  } catch (_) { res.status(500).json({ error: 'Could not load gate passes.' }); }
});


router.get('/public/usage', redeemLimiter, async (req,res) => {
  try {
    const ids = String(req.query.ids || '').split(',').slice(0,100).map(idOf).filter(Boolean);
    const rows = ids.length ? await prisma.gatePass.findMany({where:{id:{in:ids}},select:{id:true,qrUsed:true,qrUsedAt:true}}) : [];
    res.json({data:rows.map(r=>({id:Number(r.id),qr_used:r.qrUsed,qrUsedAt:r.qrUsedAt}))});
  } catch (_) { res.status(500).json({error:'Could not load gate-pass usage.'}); }
});

router.get('/:id', requireAuth, async (req,res) => {
  const id = idOf(req.params.id); if (id === null) return res.status(400).json({ error:'Invalid pass id.' });
  const row = await prisma.gatePass.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error:'Gate pass not found.' });
  if (String(req.user.role||'').toUpperCase()==='STUDENT' && String(row.studentEmail||'').toLowerCase() !== String(req.user.email||'').toLowerCase()) {
    return res.status(403).json({ error:'You are not allowed to access this gate pass.' });
  }
  if(!canAccessPass(req,row)) return res.status(403).json({error:'You are not allowed to access this gate pass.'});
  res.json({ data: jsonPass(row) });
});

router.put('/:id', requireAuth, async (req,res) => {
  const id = idOf(req.params.id); if (id === null) return res.status(400).json({ error:'Invalid pass id.' });
  try {
    const existing = await prisma.gatePass.findUnique({ where: { id } });
    if(existing && !canAccessPass(req,existing) && !(await facultyCanModifyPass(req,existing))) return res.status(403).json({error:'You are not allowed to modify this gate pass.'});
    const pass = sanitizeStudentPass(req, req.body || {}, existing);
    const existingData = existing?.data && typeof existing.data === 'object' ? existing.data : {};
    const used = !!existing?.qrUsed;
    const data = used
      ? { ...existingData, ...pass, id: Number(id), qrUsed: true, qrUsedAt: existing.qrUsedAt || existingData.qrUsedAt || pass.qrUsedAt || new Date().toISOString() }
      : { ...existingData, ...pass, id: Number(id) };
    const qrToken = existing?.qrToken || newQrToken();
    const row = existing
      ? await prisma.gatePass.update({
          where: { id },
          data: {
            status: String(data.status || existing.status),
            studentEmail: data.studentEmail || data.email || existing.studentEmail || null,
            qrToken: existing.qrToken || qrToken,
            qrUsed: used ? true : !!data.qrUsed,
            qrUsedAt: used ? (existing.qrUsedAt || new Date()) : (data.qrUsedAt ? new Date(data.qrUsedAt) : null),
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : existing.expiresAt,
            data
          }
        })
      : await prisma.gatePass.create({
          data: {
            id, status: String(data.status || 'pending'),
            studentEmail: data.studentEmail || data.email || null,
            qrToken, qrUsed: !!data.qrUsed,
            qrUsedAt: data.qrUsedAt ? new Date(data.qrUsedAt) : null,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null, data
          }
        });
    res.json({ data: jsonPass(row) });
  } catch (err) { res.status(500).json({ error:'Could not save gate pass.' }); }
});

router.post('/bulk', requireAuth, async (req,res) => {
  const passes = Array.isArray(req.body) ? req.body : [];
  try {
    const out = [];
    const role=String(req.user?.role||'').toUpperCase(), email=String(req.user?.email||'').toLowerCase();
    for (const rawPass of passes) {
      if((role==='STUDENT'||role==='COORDINATOR') && String(rawPass?.studentEmail||rawPass?.email||'').toLowerCase()!==email) continue;
      const id = idOf(rawPass?.id);
      if (id === null) continue;
      const existing = await prisma.gatePass.findUnique({ where:{id} });
      if(existing && !canAccessPass(req,existing) && !(await facultyCanModifyPass(req,existing))) continue;
      const used = !!existing?.qrUsed;
      const oldData = existing?.data && typeof existing.data === 'object' ? existing.data : {};
      const pass = sanitizeStudentPass(req, rawPass, existing);
      const data = used ? { ...oldData, ...pass, id:Number(id), qrUsed:true, qrUsedAt:existing.qrUsedAt || pass.qrUsedAt } : { ...oldData, ...pass, id:Number(id) };
      const qrToken = existing?.qrToken || newQrToken();
      const row = existing ? await prisma.gatePass.update({where:{id},data:{
        status:String(data.status || existing.status), studentEmail:data.studentEmail || data.email || existing.studentEmail || null,
        qrToken:existing.qrToken || qrToken, qrUsed:used ? true : !!data.qrUsed,
        qrUsedAt:used ? (existing.qrUsedAt || new Date()) : (data.qrUsedAt ? new Date(data.qrUsedAt) : null),
        expiresAt:data.expiresAt ? new Date(data.expiresAt) : existing.expiresAt, data
      }}) : await prisma.gatePass.create({data:{id,status:String(data.status||'pending'),studentEmail:data.studentEmail||data.email||null,qrToken,qrUsed:!!data.qrUsed,qrUsedAt:data.qrUsedAt?new Date(data.qrUsedAt):null,expiresAt:data.expiresAt?new Date(data.expiresAt):null,data}});
      out.push(jsonPass(row));
    }
    res.json({data:out});
  } catch (_) { res.status(500).json({error:'Could not save gate passes.'}); }
});


// Atomic Class Teacher / Mentor decision endpoint. The previous UI used a generic PUT
// for the whole pass object: a teacher could be correctly shown a branch-routed request
// but the backend could reject the write because only the exact mapped email was accepted.
// This endpoint makes the approval transition server-authoritative and serializes concurrent
// teacher/mentor decisions with a PostgreSQL row lock.
router.post('/:id/faculty-decision', requireAuth, async (req,res) => {
  const id=idOf(req.params.id), decision=String(req.body?.decision||'').toLowerCase();
  if(id===null || !['approved','rejected'].includes(decision)) return res.status(400).json({error:'Invalid faculty decision.'});
  const role=String(req.user?.role||'').toUpperCase();
  if(role!=='TEACHER' && role!=='MENTOR') return res.status(403).json({error:'Only Class Teachers and Mentors can make this decision.'});
  try {
    const current=await prisma.gatePass.findUnique({where:{id}});
    if(!current) return res.status(404).json({error:'Gate pass not found.'});
    if(!(await facultyCanModifyPass(req,current))) return res.status(403).json({error:'This gate pass is not assigned to you or your branch.'});
    const stageKey=role==='TEACHER'?'teacher':'mentor';
    const now=new Date().toISOString();
    const result=await prisma.$transaction(async tx=>{
      const locked=await tx.$queryRaw`SELECT "id","status","data" FROM "GatePass" WHERE "id"=${id} FOR UPDATE`;
      if(!locked.length) return {kind:'missing'};
      const row=locked[0], data=row.data && typeof row.data==='object' ? row.data : {};
      if(row.status!=='pending' || data.stage!=='teacher_mentor' || data[`${stageKey}Status`]!=='pending')
        return {kind:'moved'};
      const next={...data,[`${stageKey}Status`]:decision,[`${stageKey}DecidedBy`]:req.user.name || (stageKey==='teacher'?'Class Teacher':'Mentor'),[`${stageKey}DecidedAt`]:now,[`${stageKey}Remarks`]:String(req.body?.remarks||'').trim().slice(0,1000)};
      if(decision==='rejected') {
        next.status='rejected'; next.stage='done'; next.rejectedStage=stageKey;
        next.rejectedBy=next[`${stageKey}DecidedBy`]; next.rejectedRemarks=next[`${stageKey}Remarks`];
      } else {
        const otherKey=stageKey==='teacher'?'mentor':'teacher';
        const otherStatus=next[`${otherKey}Status`];
        const either=String(next.approvalMode||'both').toLowerCase()==='either';
        if(either || otherStatus==='not_required' || otherStatus==='approved') {
          if(either && otherStatus==='pending') {
            next[`${otherKey}Status`]='not_required';
            next[`${otherKey}Remarks`]='Not required — the other approver was not needed (Either-approver mode).';
          }
          next.stage='guardian'; next.guardianStatus='calling';
          next.guardianToken=crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
        }
      }
      const updated=await tx.gatePass.update({where:{id},data:{status:String(next.status||row.status),data:next}});
      return {kind:'ok',pass:updated,advanced:next.stage==='guardian'};
    });
    if(result.kind==='missing') return res.status(404).json({error:'Gate pass not found.'});
    if(result.kind==='moved') return res.status(409).json({error:'This approval request has already moved forward.'});
    return res.json({ok:true,advanced:result.advanced,pass:jsonPass(result.pass)});
  } catch(err) {
    console.error('[gate-passes/faculty-decision]',err?.message||err);
    return res.status(500).json({error:'Could not record the faculty approval.'});
  }
});


// Performance-only decision endpoints. They preserve the exact existing workflow and
// verification rules while avoiding re-uploading the complete pass (photo/signature) for
// every approval. The UI sequence and resulting pass/letter remain unchanged.
router.post('/:id/guardian-phone-confirm', requireAuth, async (req,res) => {
  const id=idOf(req.params.id), guardianName=String(req.body?.guardianName||'').trim().slice(0,200);
  if(id===null) return res.status(400).json({error:'Invalid pass id.'});
  try {
    const current=await prisma.gatePass.findUnique({where:{id}});
    if(!current) return res.status(404).json({error:'Gate pass not found.'});
    const role=String(req.user?.role||'').toUpperCase();
    if(role!=='ADMIN' && !(await facultyCanModifyPass(req,current))) return res.status(403).json({error:'You are not allowed to modify this gate pass.'});
    const result=await prisma.$transaction(async tx=>{
      const locked=await tx.$queryRaw`SELECT "id","status","data","studentEmail","qrToken","qrUsed","qrUsedAt","expiresAt" FROM "GatePass" WHERE "id"=${id} FOR UPDATE`;
      if(!locked.length) return {kind:'missing'};
      const row=locked[0], data=row.data && typeof row.data==='object' ? row.data : {};
      if(row.status!=='pending' || data.stage!=='guardian' || data.guardianStatus!=='calling') return {kind:'moved'};
      const now=new Date().toLocaleString();
      const staffLabel=`${req.user.name || req.user.email} (${role==='ADMIN'?'T&P Admin':role==='TEACHER'?'Class Teacher':role==='MENTOR'?'Mentor':role})`;
      const next={...data,guardianStatus:'approved',guardianDecidedAt:now,stage:'hod',guardianApprovalMethod:'phone_call',guardianConfirmedBy:staffLabel,guardianRemarks:guardianName?`Confirmed by phone call — spoke with ${guardianName}.`:'Confirmed by phone call.'};
      const updated=await tx.gatePass.update({where:{id},data:{data:next}});
      return {kind:'ok',pass:updated};
    });
    if(result.kind==='missing') return res.status(404).json({error:'Gate pass not found.'});
    if(result.kind==='moved') return res.status(409).json({error:'This request is no longer waiting on guardian consent.'});
    return res.json({ok:true,pass:jsonPass(result.pass)});
  } catch(err) {
    console.error('[gate-passes/guardian-phone-confirm]',err?.message||err);
    return res.status(500).json({error:'Could not record the guardian phone confirmation.'});
  }
});

router.post('/:id/notification-status', requireAuth, async (req,res) => {
  const id=idOf(req.params.id), via=Array.isArray(req.body?.via) ? req.body.via.map(v=>String(v).slice(0,40)).slice(0,8) : [];
  if(id===null) return res.status(400).json({error:'Invalid pass id.'});
  try {
    const current=await prisma.gatePass.findUnique({where:{id}});
    if(!current) return res.status(404).json({error:'Gate pass not found.'});
    const role=String(req.user?.role||'').toUpperCase();
    if(role!=='ADMIN' && !(await facultyCanModifyPass(req,current))) return res.status(403).json({error:'You are not allowed to modify this gate pass.'});
    const result=await prisma.$transaction(async tx=>{
      const locked=await tx.$queryRaw`SELECT "id","status","data" FROM "GatePass" WHERE "id"=${id} FOR UPDATE`;
      if(!locked.length) return {kind:'missing'};
      const row=locked[0], data=row.data && typeof row.data==='object' ? row.data : {};
      if(data.stage!=='guardian') return {kind:'moved'};
      const next={...data,guardianNotifiedVia:via};
      const updated=await tx.gatePass.update({where:{id},data:{data:next}});
      return {kind:'ok',pass:updated};
    });
    if(result.kind==='missing') return res.status(404).json({error:'Gate pass not found.'});
    if(result.kind==='moved') return res.status(409).json({error:'This request has already moved beyond guardian notification.'});
    return res.json({ok:true,pass:jsonPass(result.pass)});
  } catch(err) {
    console.error('[gate-passes/notification-status]',err?.message||err);
    return res.status(500).json({error:'Could not save guardian notification status.'});
  }
});

router.post('/:id/hod-decision', requireAuth, async (req,res) => {
  const id=idOf(req.params.id), decision=String(req.body?.decision||'').toLowerCase();
  const remarks=String(req.body?.remarks||'').trim().slice(0,1000), hodSignature=req.body?.hodSignature || null;
  if(id===null || !['approved','rejected'].includes(decision)) return res.status(400).json({error:'Invalid HOD decision.'});
  if(String(req.user?.role||'').toUpperCase()!=='ADMIN') return res.status(403).json({error:'Only T&P Admin / HOD can make the final gate-pass decision.'});
  if(decision==='approved' && !hodSignature) return res.status(400).json({error:'Please sign in the box before approving — the HOD signature appears on the endorsed letter.'});
  try {
    const result=await prisma.$transaction(async tx=>{
      const locked=await tx.$queryRaw`SELECT "id","status","data","studentEmail","qrToken","qrUsed","qrUsedAt","expiresAt" FROM "GatePass" WHERE "id"=${id} FOR UPDATE`;
      if(!locked.length) return {kind:'missing'};
      const row=locked[0], data=row.data && typeof row.data==='object' ? row.data : {};
      // HOD/Admin is the final authority. A final HOD decision must not become
      // impossible just because a Class Teacher/Mentor is missing, unavailable, or
      // the request is still sitting in an earlier approval stage. The normal
      // teacher/mentor/guardian workflow remains unchanged for ordinary requests;
      // HOD approval acts as an explicit final override when needed.
      if(row.status!=='pending' || !['teacher_mentor','guardian','hod'].includes(String(data.stage||''))) return {kind:'moved'};
      const now=new Date().toLocaleString();
      const next={...data};
      const hodOverrideStage = data.stage !== 'hod' ? String(data.stage || 'unknown') : null;
      if(decision==='approved') {
        const qrToken=crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
        // The 30-second verification timeout starts only when the guard scans.
        // The QR itself remains usable until 3 hours after the student's mentioned
        // out-date/out-time. This deadline is server-authoritative.
        const expiresAt=gatePassExpiryFromOutTime(data);
        Object.assign(next,{
          status:'approved',stage:'done',decidedAt:now,decidedBy:req.user.name||'T&P Admin',
          hodRemarks:remarks,hodSignature,qrToken,qrUsed:false,qrUsedAt:null,expiresAt,
          qrValidUntil:expiresAt ? expiresAt.toISOString() : null,
          hodOverride:!!hodOverrideStage,
          hodOverrideStage:hodOverrideStage || null,
          hodOverrideAt:hodOverrideStage ? now : null
        });
      } else {
        Object.assign(next,{status:'rejected',stage:'done',rejectedStage:'hod',rejectedBy:req.user.name||'T&P Admin',decidedAt:now,decidedBy:req.user.name||'T&P Admin',hodRemarks:remarks,hodSignature});
      }
      const updated=await tx.gatePass.update({where:{id},data:{status:next.status,qrToken:next.qrToken||row.qrToken||null,qrUsed:!!next.qrUsed,qrUsedAt:next.qrUsedAt?new Date(next.qrUsedAt):null,expiresAt:next.expiresAt?new Date(next.expiresAt):null,data:next}});
      return {kind:'ok',pass:updated};
    });
    if(result.kind==='missing') return res.status(404).json({error:'Gate pass not found.'});
    if(result.kind==='moved') return res.status(409).json({error:'This request has already moved forward.'});
    return res.json({ok:true,pass:jsonPass(result.pass)});
  } catch(err) {
    console.error('[gate-passes/hod-decision]',err?.message||err);
    return res.status(500).json({error:'Could not record the HOD decision.'});
  }
});

// Public one-time redemption endpoint used by the guard's QR scan. No login is required on the
// guard device. PostgreSQL's conditional UPDATE is the concurrency boundary.
router.post('/public/redeem', redeemLimiter, async (req,res) => {
  const id = idOf(req.body?.id), token = String(req.body?.token || '').trim();
  if (id === null || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return res.status(400).json({status:'invalid'});
  try {
    const result = await prisma.$transaction(async tx => {
      const won = await tx.gatePass.updateMany({
        where: {
          id, qrToken: token, status: 'approved', qrUsed: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { qrUsed: true, qrUsedAt: new Date() }
      });
      if (won.count === 1) {
        const row = await tx.gatePass.findUnique({where:{id}});
        return { status:'ok', row };
      }
      const row = await tx.gatePass.findUnique({where:{id}});
      if (!row || row.qrToken !== token) return { status:'invalid' };
      if (row.status !== 'approved') return { status:'not_approved' };
      if (row.qrUsed) return { status:'already_used', pass:safePublic(row) };
      if (row.expiresAt && row.expiresAt <= new Date()) return { status:'expired', pass:safePublic(row) };
      return { status:'error' };
    });
    res.json({status:result.status, pass: result.row ? safePublic(result.row) : result.pass || null});
  } catch (err) { res.status(500).json({status:'error',message:'Could not verify this gate pass.'}); }
});


module.exports = router;