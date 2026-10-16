#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const capture = process.env.MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS;
if (capture) writeFileSync(capture, `${args.join("\n")}\n`);

if (args.includes("-T")) {
  process.stderr.write(
    "Hi fixture-principal! You've successfully authenticated, but GitHub does not provide shell access.\n",
  );
  process.exit(1);
}
if (args.includes("-G")) process.exit(0);

let index = 0;
while (index < args.length && args[index].startsWith("-")) {
  if (
    ["-p", "-o", "-i", "-F", "-J", "-l", "-S", "-W"].includes(
      args[index],
    )
  ) {
    index += 2;
  } else {
    index += 1;
  }
}
index += 1; // host
const remoteCommand = args.slice(index).join(" ");
const match = remoteCommand.match(
  /^git-(upload|receive)-pack\s+['"]?([^'"]+)['"]?$/,
);
if (!match || /[\r\n\0]/.test(match[2])) process.exit(2);

let repositoryPath = match[2];
if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(repositoryPath)) {
  repositoryPath = repositoryPath.slice(1);
}
const git = process.env.MISSION_CONTROL_TEST_TRANSPORT_GIT;
if (!git) process.exit(3);
const result = spawnSync(git, [`${match[1]}-pack`, repositoryPath], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(4);
}
process.exit(result.status ?? 5);
