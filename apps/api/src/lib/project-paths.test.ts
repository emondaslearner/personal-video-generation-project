import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  assertValidProjectId,
  resolveProjectAssetPath,
} from "./project-paths.js";

test("accepts safe project IDs", () => {
  assert.equal(assertValidProjectId("project_123"), "project_123");
  assert.equal(assertValidProjectId("My-Project"), "My-Project");
});

test("rejects project IDs that can escape the project root", () => {
  for (const id of ["", "../secret", "..", "folder/project", "a".repeat(65)]) {
    assert.throws(() => assertValidProjectId(id), /Invalid project id/);
  }
});

test("resolves a relative asset path inside the project", () => {
  const result = resolveProjectAssetPath("/tmp/framewright-projects", "demo_1", "frames/scene.png");
  assert.equal(
    result.absolutePath,
    path.resolve("/tmp/framewright-projects/demo_1/frames/scene.png"),
  );
});

test("rejects POSIX and Windows absolute asset paths", () => {
  assert.throws(
    () => resolveProjectAssetPath("/tmp/projects", "demo", "/etc/passwd"),
    /Absolute asset paths/,
  );
  assert.throws(
    () => resolveProjectAssetPath("/tmp/projects", "demo", "C:\\Windows\\win.ini"),
    /Absolute asset paths/,
  );
});

test("rejects traversal using either slash convention", () => {
  for (const assetPath of ["../secret.txt", "frames/../../secret.txt", "..\\..\\secret.txt"]) {
    assert.throws(
      () => resolveProjectAssetPath("/tmp/projects", "demo", assetPath),
      /Invalid asset path/,
    );
  }
});
