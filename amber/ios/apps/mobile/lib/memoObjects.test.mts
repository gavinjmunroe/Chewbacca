import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMemoObjects } from './memoObjects.ts';
import { parseMemoActions, validMemoAction, actionKey } from './memoActions.ts';
test('people and plans retain place tags, but invented identity and place links do not', () => {
  const result = parseMemoObjects(
    {
      people: [{ name: 'Maya Chen', contactId: 'fake', places: ['Cafe', 'inferred home'] }],
      places: ['Cafe'],
      plans: [{ title: 'Coffee', places: ['Cafe'] }],
    },
    [],
  );
  assert.equal(result.people[0].contactId, '');
  assert.deepEqual(result.people[0].places, ['Cafe']);
  assert.deepEqual(result.plans[0].places, ['Cafe']);
  assert.throws(() => parseMemoObjects({}, []));
});
test('incomplete plans survive as unconfirmed drafts; times and place must be clarified', () => {
  const [plan] = parseMemoActions(
    JSON.stringify({
      actions: [{ kind: 'calendar', text: 'Coffee with Maya', title: 'Coffee', needsTiming: true }],
    }),
    [],
  );
  assert.ok(plan);
  assert.equal(validMemoAction(plan, []), false);
  assert.equal(validMemoAction({ ...plan, needsTiming: false }, []), false);
  assert.equal(validMemoAction({ ...plan, needsTiming: false, placeConfirmed: true }, []), true);
});
test('new people require an identity anchor and place can be deliberately left open', () => {
  const [person] = parseMemoActions(
    JSON.stringify({
      actions: [{ kind: 'contact', text: 'Maya likes coffee', personName: 'Maya Chen' }],
    }),
    [],
  );
  assert.equal(validMemoAction({ ...person, newPerson: true, placeConfirmed: true }, []), false);
  assert.equal(
    validMemoAction(
      { ...person, newPerson: true, personEmail: 'maya@example.org', placeConfirmed: true },
      [],
    ),
    true,
  );
  assert.notEqual(actionKey(person), actionKey({ ...person, place: 'Cafe' }));
});
