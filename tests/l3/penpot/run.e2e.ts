import { bootRuntime } from "../support/runtime.js";
import { selectServers } from "../support/stack.js";

// Entry for the Penpot stack job (npm run test:stack:l3:penpot). One stack, then the Penpot case modules only.
bootRuntime(selectServers(["penpot"]), "penpot");

await import("./prot.cases.js");
