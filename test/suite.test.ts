import { describe, it } from 'vitest';
import { tests } from '../src/tests/suite';
for (const t of tests) describe(t.area, () => it(t.name, t.run));
