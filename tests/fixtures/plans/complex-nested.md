# Complex Nested Plan

A plan with nested lists, code blocks, and edge cases.

## Section 1: Nested Lists

- [x] Parent task 1
  - [x] Nested completed task
  - [ ] Nested incomplete task
- [ ] Parent task 2
  - [ ] Another nested task
    - [x] Deeply nested completed

## Section 2: Code Blocks

Example code with checkboxes (should NOT be counted):

```markdown
- [ ] This is in a code block
- [x] This completed item is also in a code block
```

More code:

```typescript
const tasks = [
  "- [ ] fake checkbox in string",
  "- [x] another fake checkbox"
];
```

## Section 3: Edge Cases

- [X] Uppercase X (should count as completed)
- [x] Lowercase x (completed)
- [ ] Normal incomplete

Regular text with - [ ] checkbox-like pattern in middle of sentence.

## Section 4: Additional Tasks

- [ ] Final incomplete task 1
- [ ] Final incomplete task 2
- [x] Final completed task
