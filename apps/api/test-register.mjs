import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./test-shared-loader.mjs", pathToFileURL(`${process.cwd()}/`));
