import { $, log, LogEntry, fs } from "zx";

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

const { stdout: filesStr } = await $`cat ${file}`;
const files = filesStr.trim().split("\n");

const handle = await fs.open(file, "w");
for (const fileName of files) {
  await fs.write(handle, `============== ${fileName}\n\n`);
  await fs.write(
    handle,
    (await fs.readFile(fileName, "utf8")) +
      (fileName === files[files.length - 1] ? "" : "\n")
  );
}
await fs.close(handle);
const oldContents = await fs.readFile(file, "utf8");

await $`$EDITOR ${file}`;

const contents = await fs.readFile(file, "utf-8");

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
    if (
      oldNext.value[0] !== newNext.value[0] ||
      oldNext.value[1] !== newNext.value[1]
    ) {
      yield [...oldNext.value!, ...newNext.value!];
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
    await fs.writeFile(newName, newContent);
  }
}
