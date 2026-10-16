import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildV3Invocation } from "./run-v3.mjs";

const sourceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function withPackageMetadata(metadata, callback) {
  const root = mkdtempSync(path.join(tmpdir(), "mission-control-run-v3-"));
  const packageJson = JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  packageJson.companyascode.mission_control = metadata;
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("template mode runs app/v3 against bundled data without POSIX shell syntax", () => {
  withPackageMetadata(
    {
      schema_version: "companiesascode.mission_control.instance.v1",
      mode: "template",
      organization: {
        slug: "REPLACE_WITH_ORG_SLUG",
        display_name: "REPLACE_WITH_ORG_NAME",
      },
    },
    (root) => {
      const invocation = buildV3Invocation({
        root,
        command: "validate",
        env: {},
        platform: "win32",
      });
      assert.equal(invocation.executable, "bun.exe");
      assert.deepEqual(invocation.args, ["run", "validate"]);
      assert.equal(invocation.cwd, path.join(root, "app", "v3"));
      assert.equal(
        invocation.env.MISSION_CONTROL_ROOT,
        path.join(root, "templates", "organization-data"),
      );
      assert.equal(invocation.env.MISSION_CONTROL_WORKSPACE_ROOT, root);
    },
  );
});

test("organization mode defaults to app root plus its Organization parent", () => {
  withPackageMetadata(
    {
      schema_version: "companiesascode.mission_control.instance.v1",
      mode: "organization",
      organization: { slug: "Example-Org", display_name: "Example Org" },
    },
    (root) => {
      const invocation = buildV3Invocation({
        root,
        command: "export",
        args: ["--plan", "EXA-0001"],
        env: {},
      });
      assert.deepEqual(invocation.args, ["run", "export", "--plan", "EXA-0001"]);
      assert.equal(invocation.env.MISSION_CONTROL_ROOT, root);
      assert.equal(invocation.env.MISSION_CONTROL_WORKSPACE_ROOT, path.dirname(root));
    },
  );
});

test("the root wrapper never starts the server or reads the module lease", () => {
  // Lazurio Module Standard: the App starts only through app/v3 `dev` with the
  // Launchpad listener environment; there is no second start path here.
  for (const command of ["dev", "dev:server", "dev:client", "start", "preview"]) {
    assert.throws(
      () => buildV3Invocation({ root: sourceRoot, command, env: {} }),
      /Unknown app\/v3 command/,
    );
  }
  const invocation = buildV3Invocation({
    root: sourceRoot,
    command: "export",
    env: { LAZURIO_RUNTIME_LISTENER_WEB_PORT: "5734" },
  });
  assert.equal(invocation.env.LAZURIO_RUNTIME_LISTENER_WEB_PORT, "5734");
  assert.equal(invocation.env.LAZURIO_RUNTIME_LISTENER_WEB_HOST, undefined);
  assert.doesNotMatch(
    readFileSync(path.join(sourceRoot, "scripts", "run-v3.mjs"), "utf8"),
    /lazurio\.module\.json/,
  );
});

test("organization validation runs the mounted repository data validator first", () => {
  withPackageMetadata(
    {
      schema_version: "companiesascode.mission_control.instance.v1",
      mode: "organization",
      organization: { slug: "Example-Org", display_name: "Example Org" },
    },
    (root) => {
      mkdirSync(path.join(root, "db", "scripts"), { recursive: true });
      writeFileSync(path.join(root, "db", "repository-db.yaml"), "schema_version: repository-db.config.v1\n");
      writeFileSync(
        path.join(root, "db", "scripts", "validate-mission-control-data.mjs"),
        "console.log('fixture');\n",
      );
      const invocation = buildV3Invocation({
        root,
        command: "validate",
        env: {},
      });
      assert.deepEqual(invocation.preflightInvocations, [
        {
          executable: process.execPath,
          args: ["scripts/validate-mission-control-data.mjs"],
          cwd: path.join(root, "db"),
          env: invocation.env,
        },
      ]);
    },
  );
});

test("organization validation reports a clear blocker when the data mount is missing", () => {
  withPackageMetadata(
    {
      schema_version: "companiesascode.mission_control.instance.v1",
      mode: "organization",
      organization: { slug: "Example-Org", display_name: "Example Org" },
    },
    (root) => {
      assert.throws(
        () => buildV3Invocation({ root, command: "validate", env: {} }),
        /repository-db mount chybí nebo je neúplný.*repository-db\.yaml.*validate-mission-control-data\.mjs/,
      );
    },
  );
});

test("organization app tests stay isolated on bundled DEV fixtures", () => {
  withPackageMetadata(
    {
      schema_version: "companiesascode.mission_control.instance.v1",
      mode: "organization",
      organization: { slug: "Example-Org", display_name: "Example Org" },
    },
    (root) => {
      const invocation = buildV3Invocation({
        root,
        command: "test",
        env: {},
      });
      assert.deepEqual(invocation.args, ["test", "--timeout", "60000", "tests"]);
      assert.equal(
        invocation.env.MISSION_CONTROL_ROOT,
        path.join(root, "templates", "organization-data"),
      );
      assert.equal(invocation.env.MISSION_CONTROL_WORKSPACE_ROOT, root);
    },
  );
});

test("explicit operator roots override non-test mode defaults", () => {
  const invocation = buildV3Invocation({
    root: sourceRoot,
    command: "export",
    env: {
      MISSION_CONTROL_ROOT: "/operator/data",
      MISSION_CONTROL_WORKSPACE_ROOT: "/operator/workspace",
    },
  });
  assert.equal(invocation.env.MISSION_CONTROL_ROOT, "/operator/data");
  assert.equal(invocation.env.MISSION_CONTROL_WORKSPACE_ROOT, "/operator/workspace");
  assert.deepEqual(invocation.args, ["run", "export"]);
});

test("app tests overwrite inherited live Organization roots", () => {
  const invocation = buildV3Invocation({
    root: sourceRoot,
    command: "test",
    env: {
      MISSION_CONTROL_ROOT: "/operator/live-data",
      MISSION_CONTROL_WORKSPACE_ROOT: "/operator/live-workspace",
    },
  });
  assert.equal(
    invocation.env.MISSION_CONTROL_ROOT,
    path.join(sourceRoot, "templates", "organization-data"),
  );
  assert.equal(invocation.env.MISSION_CONTROL_WORKSPACE_ROOT, sourceRoot);
  assert.deepEqual(invocation.args, ["test", "--timeout", "60000", "tests"]);
});

test("unknown mode and command fail closed", () => {
  assert.throws(
    () => buildV3Invocation({ root: sourceRoot, command: "unknown", env: {} }),
    /Unknown app\/v3 command/,
  );
  withPackageMetadata({ mode: "implicit" }, (root) => {
    assert.throws(
      () => buildV3Invocation({ root, command: "validate", env: {} }),
      /mode must be template or organization/,
    );
  });
});


test("a fork can validate bundled fixtures without a private data mount, while normal validation still blocks", () => {
  withPackageMetadata(
    { schema_version: "companiesascode.mission_control.instance.v1", mode: "organization",
      organization: { slug: "Example-Org", display_name: "Example Org" } },
    (root) => {
      const invocation = buildV3Invocation({ root, command: "validate-fixtures",
        env: { MISSION_CONTROL_ROOT: "/unrelated/private-data", MISSION_CONTROL_WORKSPACE_ROOT: "/unrelated" },
        platform: "win32" });
      assert.deepEqual(invocation.args, ["run", "validate"]);
      assert.equal(invocation.executable, "bun.exe");
      assert.equal(invocation.env.MISSION_CONTROL_ROOT, path.join(root, "templates", "organization-data"));
      assert.equal(invocation.env.MISSION_CONTROL_WORKSPACE_ROOT, root);
      assert.deepEqual(invocation.preflightInvocations, []);
      assert.throws(() => buildV3Invocation({ root, command: "validate", env: {} }), /repository-db mount/);
    });
});
