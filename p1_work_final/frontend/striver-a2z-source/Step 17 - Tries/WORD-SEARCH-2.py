# Word Search II (LeetCode 212) - Trie + DFS backtracking
# Time: O(M * N * 4^L) worst case, pruned heavily by the trie. Space: O(total chars in words)
from typing import List


class TrieNode:
    def __init__(self):
        self.children = {}
        self.word = None  # full word stored at its terminal node


class Solution:
    def findWords(self, board: List[List[str]], words: List[str]) -> List[str]:
        root = TrieNode()
        for w in words:
            node = root
            for ch in w:
                node = node.children.setdefault(ch, TrieNode())
            node.word = w

        rows, cols = len(board), len(board[0]) if board else 0
        found = []

        def dfs(r, c, parent):
            ch = board[r][c]
            node = parent.children.get(ch)
            if node is None:
                return
            if node.word is not None:
                found.append(node.word)
                node.word = None  # avoid duplicates
            board[r][c] = '#'  # mark visited
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and board[nr][nc] != '#':
                    dfs(nr, nc, node)
            board[r][c] = ch  # restore
            if not node.children and node.word is None:
                parent.children.pop(ch)  # prune exhausted branch

        for r in range(rows):
            for c in range(cols):
                dfs(r, c, root)
        return found


if __name__ == "__main__":
    b = [["o","a","a","n"],["e","t","a","e"],["i","h","k","r"],["i","f","l","v"]]
    print(sorted(Solution().findWords(b, ["oath","pea","eat","rain"])))  # ['eat', 'oath']
