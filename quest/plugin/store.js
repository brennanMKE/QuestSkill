import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

export function questPath(projectRoot) {
  return join(projectRoot, ".opencode", "quest.json")
}

export async function readQuest(projectRoot) {
  try {
    return JSON.parse(await readFile(questPath(projectRoot), "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
}

export async function writeQuest(projectRoot, quest) {
  const destination = questPath(projectRoot)
  const directory = dirname(destination)
  const temporary = join(directory, `.quest.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true })

  let handle
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(quest, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, destination)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export async function clearQuest(projectRoot) {
  await rm(questPath(projectRoot), { force: true })
}
