// src/code-query/grammar-map.ts
var EXT_TO_GRAMMAR = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java"
};
function grammarForPath(filePath) {
  const lower = filePath.toLowerCase();
  for (const ext of Object.keys(EXT_TO_GRAMMAR)) {
    if (lower.endsWith(ext)) return EXT_TO_GRAMMAR[ext];
  }
  return null;
}

export {
  grammarForPath
};
//# sourceMappingURL=chunk-FDFFZLVA.js.map