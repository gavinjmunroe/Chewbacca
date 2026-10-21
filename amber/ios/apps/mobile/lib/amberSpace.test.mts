import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORK_CATEGORIES,
  ROCK_TARGETS,
  defaultSpace,
  membersFor,
  parseSpace,
  rockTarget,
  toggleNetwork,
} from './amberSpace.ts';
test('eight distinct targets place alert above, nearby below, and categories on each side', () => {
  assert.equal(ROCK_TARGETS.length, 8);
  for (const target of ROCK_TARGETS) assert.equal(rockTarget(target.x, target.y), target.action);
  assert.equal(rockTarget(0, 0), null);
  assert.equal(rockTarget(300, 300), null);
  assert.deepEqual(
    ROCK_TARGETS.filter((t) => t.x < 0).map((t) => t.action),
    ['Family', 'Friends', 'Romance'],
  );
  assert.deepEqual(
    ROCK_TARGETS.filter((t) => t.x > 0).map((t) => t.action),
    ['Work', 'School', 'Exercise'],
  );
});
test('circles never guess membership, and toggling off returns every relationship', () => {
  const space = defaultSpace('Sagar', true);
  for (const category of NETWORK_CATEGORIES)
    assert.deepEqual(membersFor(space, category, ['a', 'b']), []);
  assert.equal(toggleNetwork('Work', 'Work'), 'All');
  assert.deepEqual(membersFor(space, 'All', ['a', 'b']), ['a', 'b']);
  space.memberships.Family = ['a', 'deleted'];
  assert.deepEqual(membersFor(space, 'Family', ['a', 'b']), ['a']);
});
test('legacy unassigned views restore to all without creating inferred circles', () => {
  const restored = parseSpace(
    {
      active: 'Personal',
      memberships: { Personal: ['a'], Family: ['b', 'b', 4] },
      profile: { accent: 'bad' },
    },
    defaultSpace(),
  );
  assert.equal(restored.active, 'All');
  assert.deepEqual(restored.memberships, { Family: ['b'] });
  assert.equal(restored.profile.accent, '#A9641D');
});
