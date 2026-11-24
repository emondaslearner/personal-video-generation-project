export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@framewright/shared") {
    const sharedEntry = new URL("../../packages/shared/dist/index.js", import.meta.url);
    return nextResolve(sharedEntry.href, context);
  }

  return nextResolve(specifier, context);
}
