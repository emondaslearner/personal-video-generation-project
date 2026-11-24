import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framewright-project-tests-"));
process.env.PROJECTS_DIR = projectsRoot;

const {
  createProject,
  getProject,
  listProjects,
  saveProject,
} = await import("./projects.js");

after(async () => {
  await fs.rm(projectsRoot, { recursive: true, force: true });
});

test("creates a project with the expected persistent directory structure", async () => {
  const project = await createProject("project_create_test", "Create Test");

  assert.equal(project.project.id, "project_create_test");
  assert.equal(project.project.title, "Create Test");

  for (const directory of [
    "frames",
    "audio",
    "references",
    "music",
    "sound-effects",
    "exports",
  ]) {
    const directoryStat: Awaited<ReturnType<typeof fs.stat>> = await fs.stat(
      path.join(projectsRoot, project.project.id, directory),
    );
    assert.equal(directoryStat.isDirectory(), true);
  }

  const stored = JSON.parse(
    await fs.readFile(path.join(projectsRoot, project.project.id, "project.json"), "utf-8"),
  );
  assert.equal(stored.project.id, project.project.id);
});

test("lists and loads only valid persisted projects", async () => {
  await createProject("project_list_test", "List Test");
  await fs.mkdir(path.join(projectsRoot, "invalid_project"));
  await fs.writeFile(path.join(projectsRoot, "invalid_project", "project.json"), "{bad json");

  const projects = await listProjects();
  assert.equal(projects.some((project) => project.id === "project_list_test"), true);
  assert.equal(projects.some((project) => project.id === "invalid_project"), false);

  const loaded = await getProject("project_list_test");
  assert.equal(loaded.project.title, "List Test");
});

test("rejects duplicate project creation without overwriting the existing project", async () => {
  await createProject("project_duplicate_test", "Original");

  await assert.rejects(
    () => createProject("project_duplicate_test", "Replacement"),
    (error: { statusCode?: number }) => error.statusCode === 409,
  );

  const loaded = await getProject("project_duplicate_test");
  assert.equal(loaded.project.title, "Original");
});

test("saves an existing project atomically and updates its timestamp", async () => {
  const created = await createProject("project_save_test", "Before");
  const saved = await saveProject({
    ...created,
    project: { ...created.project, title: "After" },
  });

  assert.equal(saved.project.title, "After");
  assert.ok(saved.project.updatedAt);

  const loaded = await getProject("project_save_test");
  assert.equal(loaded.project.title, "After");
});

test("does not create a project when saving an unknown ID", async () => {
  const { createEmptyProject } = await import("@framewright/shared");
  const project = createEmptyProject("project_missing_test", "Missing");

  await assert.rejects(
    () => saveProject(project),
    (error: { statusCode?: number }) => error.statusCode === 404,
  );

  await assert.rejects(
    () => fs.access(path.join(projectsRoot, "project_missing_test")),
  );
});
