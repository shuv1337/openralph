# Code Block Test Plan

This file tests that checkboxes inside code blocks are NOT counted.

## Real Tasks

- [x] Real completed task 1
- [x] Real completed task 2
- [ ] Real incomplete task 1
- [ ] Real incomplete task 2
- [ ] Real incomplete task 3

## Code Block Examples (should NOT be counted)

```markdown
- [ ] Fake checkbox in markdown code block
- [x] Fake completed in markdown code block
```

```typescript
const example = `
- [ ] Fake checkbox in TypeScript code block
- [x] Another fake checkbox
`;
```

```
- [ ] Fake in plain code block
```

## Summary

Real tasks: 2 completed, 3 incomplete (total: 5)
Fake tasks in code blocks: 3 incomplete, 3 completed (should be ignored)
