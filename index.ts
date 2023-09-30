#!/usr/bin/env node

import { isText } from "istextorbinary";
import memoizee from "memoizee";
import { $, fs, log, LogEntry } from "zx";

$.log = (entry: LogEntry) => {
  switch (entry.kind) {
    case "stdout":
      break;
    default:
      log(entry);
  }
};

const fileProcessOutput = await $`mktemp`;
const file = fileProcessOutput.stdout.trim();
await $`fd -t file > ${file}`;
await $`$EDITOR ${file}`;

const filesStr = (await Bun.file(file).text()).trim();
const getBuffer = memoizee(async (file: string) => {
  return Buffer.from(await Bun.file(file).arrayBuffer());
});
const files = await (async () => {
  const files = filesStr.split("\n");
  const ret: string[] = [];
  for (const file of files) {
    if (isText(file, await getBuffer(file))) {
      ret.push(file);
    }
  }
  return ret;
})();

const handle = Bun.file(file).writer();
for (const fileName of files) {
  handle.write(`============== ${fileName}\n\n`);
  handle.write(
    (await getBuffer(fileName)).toString() +
      (fileName === files[files.length - 1] ? "" : "\n")
  );
}
await handle.end();
const oldContents = await Bun.file(file).text();

await $`$EDITOR ${file}`;

const contents = await Bun.file(file).text();

function* getContents(content: string) {
  while (content) {
    const [matched, newFileName] = content.match(/============== (.+)/)!;
    const rest = content.slice(matched.length + 2);
    const next = rest.match(/\n==============/)!;
    if (!next) {
      yield [newFileName, rest];
      break;
    }
    const myContent = rest.slice(0, next.index!);
    yield [newFileName, myContent];
    content = rest.slice(next.index! + 1);
  }
}

function* mixContents() {
  const oldContentGenerator = getContents(oldContents);
  const newContentGenerator = getContents(contents);

  while (true) {
    const oldNext = oldContentGenerator.next();
    const newNext = newContentGenerator.next();
    if (oldNext.done && newNext.done) {
      break;
    }
    const [oldValue, newValue] = [oldNext.value!, newNext.value!];
    if (oldValue[0] !== newValue[0] || oldValue[1] !== newValue[1]) {
      yield [...oldValue, ...newValue];
    }
  }
}

for (const [oldName, oldContent, newName, newContent] of mixContents()) {
  if (oldName !== newName) {
    log({
      cmd: `mv ${oldName} ${newName}`,
      kind: "cmd",
      verbose: true,
    });
    await fs.move(oldName, newName);
  }
  if (oldContent !== newContent) {
    log({
      cmd: `write ${newName}`,
      kind: "cmd",
      verbose: true,
    });
    await Bun.write(newName, newContent);
  }
}
