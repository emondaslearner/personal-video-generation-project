import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framewright-api-tests-"));
process.env.PROJECTS_DIR = projectsRoot;

const { buildApp } = await import("./app.js");
const app = await buildApp();

function multipartFile(filename: string, mimeType: string, content: string) {
  const boundary = "----framewright-test-boundary";
  const crlf = String.fromCharCode(13, 10);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${mimeType}`,
      "",
      content,
      `--${boundary}--`,
      "",
    ].join(crlf),
  };
}

after(async () => {
  await app.close();
  await fs.rm(projectsRoot, { recursive: true, force: true });
});

test("health and project list routes are accessible without an unexpected 401", async () => {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const projects = await app.inject({ method: "GET", url: "/projects" });
  assert.equal(projects.statusCode, 200);
  assert.deepEqual(projects.json(), { projects: [] });
});

test("creates, opens, updates, and lists a persisted project", async () => {
  const create = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { title: "API Integration Test" },
  });
  assert.equal(create.statusCode, 201);

  const project = create.json().project;
  const projectId = project.project.id;

  const open = await app.inject({ method: "GET", url: `/projects/${projectId}` });
  assert.equal(open.statusCode, 200);
  assert.equal(open.json().project.project.title, "API Integration Test");

  const updatedProject = {
    ...open.json().project,
    project: { ...project.project, title: "Updated Integration Test" },
  };
  const save = await app.inject({
    method: "PUT",
    url: `/projects/${projectId}`,
    payload: updatedProject,
  });
  assert.equal(save.statusCode, 200);
  assert.equal(save.json().project.project.title, "Updated Integration Test");

  const list = await app.inject({ method: "GET", url: "/projects" });
  assert.equal(list.statusCode, 200);
  assert.equal(
    list.json().projects.some((item: { id: string }) => item.id === projectId),
    true,
  );
});

test("rejects invalid project IDs and duplicate project creation", async () => {
  const invalid = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { id: "../outside", title: "Invalid" },
  });
  assert.equal(invalid.statusCode, 400);

  const first = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { id: "duplicate_project", title: "Original" },
  });
  assert.equal(first.statusCode, 201);

  const duplicate = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { id: "duplicate_project", title: "Replacement" },
  });
  assert.equal(duplicate.statusCode, 409);
});

test("serves project assets and rejects missing assets", async () => {
  const create = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { id: "asset_project", title: "Asset Test" },
  });
  assert.equal(create.statusCode, 201);

  const assetPath = path.join(projectsRoot, "asset_project", "frames", "scene.txt");
  await fs.writeFile(assetPath, "Framewright asset test", "utf-8");

  const asset = await app.inject({
    method: "GET",
    url: "/assets/asset_project/frames/scene.txt",
  });
  assert.equal(asset.statusCode, 200);
  assert.equal(asset.body, "Framewright asset test");

  const missing = await app.inject({
    method: "GET",
    url: "/assets/asset_project/frames/missing.png",
  });
  assert.equal(missing.statusCode, 404);
});


test("uploads an image safely and records it in the project asset index", async () => {
  const create = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { id: "upload_project", title: "Upload Test" },
  });
  assert.equal(create.statusCode, 201);

  const upload = await app.inject({
    method: "POST",
    url: "/projects/upload_project/assets/frames",
    ...multipartFile("../../unsafe-name.png", "image/png", "fake-png-content"),
  });
  assert.equal(upload.statusCode, 201);
  const asset = upload.json().asset;
  assert.equal(asset.path.startsWith("frames/"), true);
  assert.equal(asset.size, Buffer.byteLength("fake-png-content"));

  const project = await (await app.inject({
    method: "GET",
    url: "/projects/upload_project",
  })).json().project;
  assert.deepEqual(project.assets.images, [asset.path]);

  const download = await app.inject({
    method: "GET",
    url: `/assets/upload_project/${asset.path}`,
  });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, "fake-png-content");
});

test("rejects unsupported asset types and unknown upload categories", async () => {
  const create = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { id: "upload_validation", title: "Upload Validation" },
  });
  assert.equal(create.statusCode, 201);

  const badType = await app.inject({
    method: "POST",
    url: "/projects/upload_validation/assets/frames",
    ...multipartFile("payload.exe", "application/octet-stream", "not an image"),
  });
  assert.equal(badType.statusCode, 415);

  const badCategory = await app.inject({
    method: "POST",
    url: "/projects/upload_validation/assets/unknown",
    ...multipartFile("payload.png", "image/png", "data"),
  });
  assert.equal(badCategory.statusCode, 400);
});
