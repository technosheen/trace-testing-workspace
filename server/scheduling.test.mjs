import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSchedule,nextScheduleAt} from './scheduling.mjs';
const cron=(cronExpression,timeZone='UTC')=>({scheduleType:'cron',cronExpression,timeZone});
test('interval schedules remain backward compatible',()=>{
 assert.deepEqual(normalizeSchedule({intervalHours:24}),{scheduleType:'interval',intervalHours:24});
 assert.equal(nextScheduleAt({intervalHours:2},'2026-10-11T08:20:30Z'),'2026-10-11T10:20:30.000Z');
 for(const intervalHours of [0,0.5,169,'24',NaN]) assert.throws(()=>normalizeSchedule({intervalHours}));
});
test('cron validates syntax, values, cadence and timezone',()=>{
 assert.equal(normalizeSchedule(cron('  0   */2 * * 1-5 ')).cronExpression,'0 */2 * * 1-5');
 for(const expression of ['* * * * *','0,30 * * * *','*/15 * * * *','60 * * * *','0 24 * * *','0 8 * * MON','0 8 1 *','0 8 * * * *','0 8 5-2 * *','0 8 */0 * *']) assert.throws(()=>normalizeSchedule(cron(expression)),expression);
 assert.throws(()=>normalizeSchedule(cron('0 8 * * *','Not/AZone')));
 assert.throws(()=>nextScheduleAt(cron('0 8 * * *'),'invalid'));
});
test('strict next occurrence and lists ranges steps Sunday alias',()=>{
 assert.equal(nextScheduleAt(cron('0 */2 * * *'),'2026-10-11T08:00:00Z'),'2026-10-11T10:00:00.000Z');
 assert.equal(nextScheduleAt(cron('15 9,17 * * 1-5'),'2026-10-09T17:15:00Z'),'2026-10-12T09:15:00.000Z');
 assert.equal(nextScheduleAt(cron('0 8 * * 7'),'2026-10-10T08:00:00Z'),'2026-10-11T08:00:00.000Z');
 assert.equal(nextScheduleAt(cron('0 1-5/2 * * *'),'2026-10-11T01:00:00Z'),'2026-10-11T03:00:00.000Z');
});
test('day of month and weekday use standard OR semantics',()=>{
 assert.equal(nextScheduleAt(cron('0 8 1 * 1'),'2026-10-02T00:00:00Z'),'2026-10-05T08:00:00.000Z');
});
test('timezone converts local hours including fractional-hour offsets',()=>{
 assert.equal(nextScheduleAt(cron('0 9 * * *','America/New_York'),'2026-10-11T00:00:00Z'),'2026-10-11T13:00:00.000Z');
 assert.equal(nextScheduleAt(cron('0 9 * * *','Asia/Kathmandu'),'2026-10-11T00:00:00Z'),'2026-10-11T03:15:00.000Z');
});
test('DST spring gap skipped and autumn repeated hour handled',()=>{
 assert.equal(nextScheduleAt(cron('30 2 * * *','America/New_York'),'2026-03-08T00:00:00Z'),'2026-03-09T06:30:00.000Z');
 assert.equal(nextScheduleAt(cron('30 1 * * *','America/New_York'),'2026-11-01T05:30:00Z'),'2026-11-01T06:30:00.000Z');
 assert.equal(nextScheduleAt(cron('45 1 * * *','Australia/Lord_Howe'),'2026-04-04T14:45:00Z'),'2026-04-05T15:15:00.000Z');
});
test('bounded rare dates support leap years and reject impossible dates',()=>{
 assert.equal(nextScheduleAt(cron('0 8 29 2 *'),'2026-10-11T00:00:00Z'),'2028-02-29T08:00:00.000Z');
 assert.throws(()=>nextScheduleAt(cron('0 8 31 2 *'),'2026-10-11T00:00:00Z'),/five years/);
});
