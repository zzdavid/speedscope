import {CallTreeProfileBuilder, ProfileGroup, FrameInfo} from '../lib/profile'
import {ProfileDataSource} from '../import/utils'

// Custom import for DIPS profiling logs

interface ProfCall {
  // parsed
  context: string
  callID: string
  parentCallID: string
  rootCallID: string
  threadID: number
  at: number        // timestamp milliseconds
  elapsed: number   // milliseconds
  appID: string
  host: string
  // calculated
  parent: ProfCall | null
  children: ProfCall[]
}

//const ColVersion = 0
const ColTimestamp = 1
//const ColEnvironment = 2
const ColAppID = 3
const ColHostName = 4
//const ColDotNetTaskId = 5
const ColThreadID = 6
const ColRootCallID = 7
const ColCallID = 8
const ColParentCallID = 9
//const ColCallLevel = 10
const ColElapsed = 11
//const ColReserved = 12
const ColContext = 13
//const ColSessionId = 14

class MyBuilder extends CallTreeProfileBuilder {
  lastEventAt : number = 0

  enterFrame(frameInfo: FrameInfo, value: number) {
    this.lastEventAt = value;
    super.enterFrame(frameInfo, value)
  }

  leaveFrame(frameInfo: FrameInfo, value: number) {
    this.lastEventAt = value;
    super.leaveFrame(frameInfo, value)
  }
}

function parseTimestamp(s : string): number {
  // Parse as local time and return number of milliseconds
  // since 1970-01-01
  return new Date(parseInt(s.substr(0, 4)),   // year
                  parseInt(s.substr(4, 2))-1, // month (0-11)
                  parseInt(s.substr(6, 2)),   // day
                  parseInt(s.substr(8, 2)),   // hours
                  parseInt(s.substr(10, 2)),  // minutes
                  parseInt(s.substr(12, 2)),  // seconds
                  parseInt(s.substr(14, 3))   // milliseconds
                  ).valueOf()
}

function parseCall(rawEvent: string): ProfCall {
  const cols = rawEvent.split(';')

  return {
    // parsed
    context: cols[ColContext],
    callID: cols[ColCallID],
    parentCallID: cols[ColParentCallID],
    rootCallID: cols[ColRootCallID],
    threadID: parseInt(cols[ColThreadID]),
    at: parseTimestamp(cols[ColTimestamp]),
    elapsed: parseInt(cols[ColElapsed]),
    appID: cols[ColAppID],
    host: cols[ColHostName],
    // calculated
    parent: null,
    children: []
  };
}

function setUpRelations(calls: ProfCall[]) {
  const callIdMap = new Map<string, ProfCall>()

  for (let call of calls) {
    callIdMap.set(call.callID, call)
  }

  for (let call of calls) {
    const parent = callIdMap.get(call.parentCallID)
    if (parent)
    {
      call.parent = parent
      parent.children.push(call)
    }
  }  
}

function startTimestampsAtZero(calls: ProfCall[]) {
  // Find first timestamp. It should be the first top-level call
  // but we might as well check all
  let min = Number.MAX_SAFE_INTEGER

  for (let call of calls)
    if (call.at < min)
      min = call.at

  for (let call of calls) {
    call.at -= min
  }
}

function getBuilderForCall(call: ProfCall, builders: MyBuilder[], width : number) : MyBuilder {
  // Profiles can't show simultaneous calls. Find a free profile
  // for this call or create a new one.
  let found = builders.find(bldr => bldr.lastEventAt <= call.at)

  if (!found) {
    found = new MyBuilder(width)
    found.setName(`Group ${builders.length + 1}`)
    builders.push(found)
  }

  return found
}

function ensureWithinInterval(value: number, min: number, max: number) : number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function addFrames(call: ProfCall, builder: MyBuilder, parent_end: number) {
  const app = `App-${call.appID}@${call.host}`

  const frameInfo : FrameInfo = {
    key: app + ';' + call.context,
    name: call.context,
    file: app
  }

  // We need to adjust the times b/c timestamps and elapsed times are not
  // exact and sometimes there is a millisecond overlap, which would cause
  // the builder to fail
  let start = ensureWithinInterval(call.at, builder.lastEventAt, parent_end)
  let end = ensureWithinInterval(start + call.elapsed, start, parent_end)

  try {
    builder.enterFrame(frameInfo, start)

    for (let child of call.children) {
      addFrames(child, builder, end)
    }

    builder.leaveFrame(frameInfo, end)
  }
  catch (_e)
  {
    const err : Error = _e
    err.message += '\nError at CallID: ' + call.callID
    throw err
  }
}

export async function importDIPSProfiling(dataSource: ProfileDataSource): Promise<ProfileGroup | null> {
  let contents = await dataSource.readAsText()

  const calls = contents.split('\r\n')
                        .filter(s => s.startsWith('1;'))
                        .map(parseCall)

  if (calls.length == 0) {
    return null
  }

  setUpRelations(calls)
  startTimestampsAtZero(calls)

  let width = 0
  for (let call of calls)
    if (call.at + call.elapsed > width)
      width = call.at + call.elapsed
  
  const profiles : MyBuilder[] = []

  for (let call of calls) {
    if (!call.parent) {
      const builder = getBuilderForCall(call, profiles, width)
      addFrames(call, builder, width)
    }
  }

  return {
    name: '',
    indexToView: 0,
    profiles: profiles.map(p => p.build()),
  }
}

export function isDIPSProfiling(contents: string): boolean {
  if (!contents) {
    return false
  }

  if (!contents.startsWith('1;')) {
    return false
  }

  const row = contents.split('\r\n')[0]
  const cols = row.split(';')

  return cols.length == 21
}