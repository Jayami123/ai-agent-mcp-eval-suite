// Entry for the lab-only host cases (npm run test:stack:l3:host). The attack-lab must already be running (CI: npm run
// lab:up; local: node dist/attack-lab/main.js). This file starts and stops nothing.
await import("./lab.cases.js");
