// Export project-owned data into the native app; no JavaScript runs inside the EXE.
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = await mkdtemp(join(tmpdir(), 'scaner-knowledge-'));
try {
  const output = join(temp, 'knowledge.mjs');
  await build({stdin: {contents: `
    import { GENERIC_DTCS } from './src/knowledge/dtc/generic';
    import { GENERIC_RANGES, VEHICLE_RANGES } from './src/knowledge/ranges/generic';
    import { buscarFallaVag } from './src/knowledge/vag/faults';
    import { buscarGrupoVag } from './src/knowledge/vag/groups';
    import { defMe75Referencia } from './src/core/tune/me75';
    import { defSimulador } from './src/core/tune/nativas';
    export default { dtcs: GENERIC_DTCS, ranges: [...GENERIC_RANGES, ...VEHICLE_RANGES],
      vagFaults: Array.from({length:65536},(_,i)=>buscarFallaVag(String(i).padStart(5,'0'))).filter(Boolean),
      vagGroups: Array.from({length:256},(_,i)=>buscarGrupoVag(i)).filter(Boolean),
      definitions: [defSimulador,defMe75Referencia] };
  `,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:output});
  const {default:data}=await import(pathToFileURL(output));
  await writeFile(resolve('native/Scaner.Core/Data/knowledge.json'),JSON.stringify(data,null,2)+'\n');
  console.log(`Exported ${data.dtcs.length} DTC references, ${data.ranges.length} ranges, ${data.vagFaults.length} VAG faults and ${data.definitions.length} map definitions.`);
} finally { await rm(temp,{recursive:true,force:true}); }
