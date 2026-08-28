// Thin barrel over the split reader controllers — the single import surface for
// all 13 reader endpoint handlers. The implementations live in ./reader/*, one
// module per concern; schemas live in ../schemas/reader.js.
export { registerBegin, registerComplete, authBegin, authComplete } from './reader/auth.js';
export { addDeviceBegin, addDeviceComplete } from './reader/credentials.js';
export { recoverRequest, recoverBegin, recoverComplete } from './reader/recovery.js';
export { getReader, uploadPhoto, getRecoveryEmail, setRecoveryEmail } from './reader/profile.js';
export { listTopReaders } from './reader/list.js';
