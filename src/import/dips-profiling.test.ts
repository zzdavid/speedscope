import {checkProfileSnapshot} from '../lib/test-utils'
import { isDIPSProfiling } from './dips-profiling'

test('importDIPSProfiling simple', async () => {
  await checkProfileSnapshot('./sample/profiles/DIPS/simple-profiling.log')
})

test('importDIPSProfiling error out of order', async () => {
  // Failed with "Samples must be provided in increasing order of cumulative value. Last
  // sample was 10, this sample was 9" at U8uBT54VskG+Nrn4aduCOg
  await checkProfileSnapshot('./sample/profiles/DIPS/out-of-order-profiling.log')
})

test('isDIPSProfiling returns true on valid format', () => {
  const valid = 
`1;20191107120357753;NA;58;vt-irq0-srv01;;66;t4f1n7Ev/k6tIC1J8weZHQ;CsX7tNLaAE6LFxFnPYx1WA;zZztk7B6P0+bH37Uh826SA;3;47;;DFS/FS/AuditEventPublisher/PostAuditEventAsync.HttpCall;nG8uRYlMGEaPaMBJtaGnOA;;0;1573128237753346;1573128237801129;;
1;20191107120357751;NA;58;vt-irq0-srv01;;66;t4f1n7Ev/k6tIC1J8weZHQ;zZztk7B6P0+bH37Uh826SA;N3ps3DPsc0OAMe/iI8/0IA;2;49;;DFS/FS/AuditEventPublisher/PostAuditEventAsync;nG8uRYlMGEaPaMBJtaGnOA;;0;1573128237751684;1573128237801289;;`;
  expect(isDIPSProfiling(valid)).toBe(true);
})

test('isDIPSProfiling returns false on invalid format', () => {
  const invalid = "a;b;c;d;e;f;g;h;i;j;k;l;m;n;o;p;q;r;s;t;u;v;w;x;y;z 1";
  expect(isDIPSProfiling(invalid)).toBe(false);
})
