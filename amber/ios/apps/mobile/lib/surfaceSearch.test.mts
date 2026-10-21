import test from 'node:test';
import assert from 'node:assert/strict';
import { webSearchRequest, calendarSources, communitySourceLabels } from './surfaceSearch.ts';
test('turning Amber off keeps both surfaces local even when a query exists', () => {
  assert.equal(webSearchRequest('people', false, 'designer'), null);
  assert.equal(webSearchRequest('calendar', false, 'running'), null);
});
test('blank web submissions do not open a modal or request discovery', () => {
  for (const surface of ['people', 'calendar'] as const)
    assert.equal(webSearchRequest(surface, true, ' \n '), null);
});
test('each web search opens its own typed discovery flow', () => {
  assert.deepEqual(webSearchRequest('people', true, '  designers  '), {
    query: 'designers',
    web: true,
    scope: 'network',
  });
  assert.deepEqual(webSearchRequest('calendar', true, '  running  '), {query:'running',web:true,scope:'day'});
});
test('surface connections have their intended labels and ordering', () => {
  assert.deepEqual(communitySourceLabels, { Apple: 'Contacts', Google: 'Gmail' });
  assert.deepEqual(calendarSources, [
    'Apple Health',
    'Google Calendar',
    'Whoop',
    'Oura',
    'Garmin',
    'Strava',
    'MyChart',
    'Function',
  ]);
});
