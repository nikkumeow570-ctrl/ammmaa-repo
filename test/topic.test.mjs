import test from 'node:test';
import assert from 'node:assert/strict';
import { topicKind, MESSAGES } from '../public/shared.js';

test('topic: replies in English, Tanglish and Tamil are matched to the right recorded topic', () => {
  const cases = [
    ['Eat something warm, kanna.', 'meal'], ['Have you had lunch yet?', 'meal'], ['Ippove poi saapdu.', 'meal'], ['சாப்பிட்டியா கண்ணா?', 'meal'],
    ['Drink some water, chellam.', 'water'], ['Thanni kudichiya?', 'water'], ['தண்ணி குடிச்சியா செல்லம்?', 'water'],
    ['Go to sleep now, kanna.', 'bedtime'], ['Thoongu kanna.', 'bedtime'], ['தூங்கு கண்ணா.', 'bedtime'],
    ['Take a short walk and rest your eyes.', 'break'], ['Konjam ezhundhu nada kannu.', 'break'], ['கொஞ்சம் எழுந்து நட கண்ணு.', 'break'],
    ['Good morning, kanna!', 'morning'], ['Vanakkam kanna.', 'morning'], ['காலை வணக்கம் செல்லம்!', 'morning'],
    ['Call home when you can.', 'call'], ['Veettukku phone pannu kanna.', 'call'], ['வீட்டுக்கு போன் பண்ணு கண்ணு.', 'call'],
    ['The weather is lovely today.', ''], ['', ''], [undefined, ''],
  ];
  for (const [text, want] of cases) assert.equal(topicKind(text), want, String(text));
});

test('topic: "put the phone down" is about sleep, not about calling', () => {
  assert.notEqual(topicKind('Put the phone down. Tomorrow is another day.'), 'call');
  assert.notEqual(topicKind('Phone-a vechutu padu, naalaiku paakalaam.'), 'call');
});

test('topic: on Amma\'s own 108 lines it finds the right topic far more often than the wrong one', () => {
  let right = 0, wrong = 0;
  for (const lang of Object.keys(MESSAGES)) for (const tone of Object.keys(MESSAGES[lang])) for (const kind of Object.keys(MESSAGES[lang][tone])) {
    for (const line of MESSAGES[lang][tone][kind]) {
      const got = topicKind(line);
      if (got === kind) right++;
      else if (got) wrong++;
    }
  }
  assert.ok(right >= 70, `only ${right} lines matched their own topic`);
  assert.ok(wrong <= 14, `${wrong} lines matched a different topic`);
});
