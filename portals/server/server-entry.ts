// Entry point for the compiled Portals server script.
//
// Everything worth testing lives in referee.ts, driven by an injected host so
// it runs in a plain unit test. This file is only the seam onto the frozen
// `server` global the sandbox provides, which is why it holds no rules.

import { createReferee, type RefereeHost } from "./referee";

declare const server: RefereeHost;

createReferee(server);
