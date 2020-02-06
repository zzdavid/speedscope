import {CallTreeProfileBuilder, ProfileGroup, FrameInfo} from '../lib/profile'
import {ProfileDataSource, MultiFileDataSource} from '../import/utils'

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

interface ImportFile {
  calls: ProfCall[]
  callsTo: Map<ImportFile, number>
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

function setUpRelationsOnAllCalls(files: ImportFile[]) {
  let calls : ProfCall[] = []
  
  for (let file of files) {
    calls = calls.concat(file.calls)
  }

  setUpRelations(calls)
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

function timeOfFirstCall(calls: ProfCall[]) : number {
  // Find first timestamp. It should be the first top-level call
  // but we might as well check all
  let min = Number.MAX_SAFE_INTEGER

  for (let call of calls)
    if (call.at < min)
      min = call.at

  return min
}

function translateByOffset(files : ImportFile[], offset : number) {
  for (let file of files) {
    for (let call of file.calls) {
      call.at += offset
    }
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

function adjustToInterval(value: number, min: number, max: number) : number {
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
  let start = adjustToInterval(call.at, builder.lastEventAt, parent_end)
  let end = adjustToInterval(start + call.elapsed, start, parent_end)

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

async function parseFile(dataSource: ProfileDataSource): Promise<ImportFile> {
  let contents = await dataSource.readAsText()

  const calls = contents.split('\r\n')
                        .filter(s => s.startsWith('1;'))
                        .map(parseCall)

  return {
    calls: calls,
    callsTo: new Map<ImportFile, number>()
  }
}

function guessTopLevelFile(files: ImportFile[]): ImportFile {
  if (files.length == 1) {
    // quick return for performance
    return files[0]
  }

  let callMap = new Map()

  // Map callID -> file
  for (let file of files) {
    for (let call of file.calls) {
      callMap.set(call.callID, file)
    }
  }

  // Fill in callsTo
  for (let file of files) {
    for (let call of file.calls) {
      const parent = callMap.get(call.parentCallID)
      if (parent && parent !== file) {
        const n = parent.callsTo.get(file) || 0
        parent.callsTo.set(file, n+1)
      }
    }
  }

  // Find the first file in the call chain, i.e. from the service that calls other services
  let first = files[0]

  for (let file of files)
  {
    if ((file.callsTo.get(first) || 0) > (first.callsTo.get(file) || 0)) {
      first = file
    }
  }

  return first
}

function filterByRootIDs(files: ImportFile[], rootIDs : Set<string>) {
  for (var file of files)
    file.calls = file.calls.filter(c => rootIDs.has(c.rootCallID))
}

function toSet<T>(array : Array<T>) : Set<T> {
  const set = new Set<T>()
  for (var item of array) {
    set.add(item)
  }
  return set
}

export async function importDIPSProfiling(dataSource: ProfileDataSource): Promise<ProfileGroup | null> {
  let dataSources = (dataSource instanceof MultiFileDataSource) ?
                        (dataSource as MultiFileDataSource).dataSources : [dataSource]

  let files = await Promise.all(dataSources.map(d => parseFile(d)))
  
  files = files.filter(f => f.calls.length > 0)
  
  if (files.length == 0) {
    return null
  }

  // We'll only show calls from the first file in the call order. The 
  // others are called from this and are just adding frames to the profile.

  const primaryFile = guessTopLevelFile(files)
  const extraFiles = files.filter(f => f !== primaryFile)

  const rootCallIDs = toSet(primaryFile.calls.map(c => c.rootCallID))

  filterByRootIDs(extraFiles, rootCallIDs)

  const offset = -timeOfFirstCall(primaryFile.calls)

  translateByOffset(files, offset)

  setUpRelationsOnAllCalls(files)

  const topCalls = primaryFile.calls.filter(c => c.parent == null)
  const width = topCalls[topCalls.length-1].at + topCalls[topCalls.length-1].elapsed  
  const profiles : MyBuilder[] = []

  for (let call of topCalls) {
    const builder = getBuilderForCall(call, profiles, width)
    addFrames(call, builder, width)
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