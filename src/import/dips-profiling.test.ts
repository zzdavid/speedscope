import {checkProfileSnapshot} from '../lib/test-utils'

test('importDIPSProfiling simple', async () => {
  await checkProfileSnapshot('./sample/profiles/DIPS/simple-profiling.log')
})

test('importDIPSProfiling error out of order', async () => {
  // Failed with "Samples must be provided in increasing order of cumulative value. Last
  // sample was 10, this sample was 9" at U8uBT54VskG+Nrn4aduCOg
  await checkProfileSnapshot('./sample/profiles/DIPS/out-of-order-profiling.log')
})
