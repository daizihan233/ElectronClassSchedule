import path from "path";
import fs from "fs";
import { exec } from "child_process";
const url = path.join(process.cwd(), "package.json");
const json = fs.readFileSync(url, "utf-8");
const pkg = JSON.parse(json);
import dayjs from "dayjs";
const formattedTime = dayjs().format("YYYYMMDD")

try {
  pkg.version = formattedTime;
  fs.writeFileSync(url, JSON.stringify(pkg, null, 2));
  const build = exec("npm run buildNew");
  build.stdout.on("data", (data) => console.log(data));
} catch (error) {
  console.log("error", error);
}

