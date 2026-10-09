import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";
// Read stdin without echoing or persisting the password. Never pass it as a CLI argument.
if (!process.stdin.isTTY) {
  console.error("Run this command in an interactive terminal.");
  process.exit(1);
}
process.stdout.write("Workspace password (minimum 16 characters): ");
process.stdin.setRawMode(true);
process.stdin.resume();
let password = "";
process.stdin.on("data", (buffer) => {
  for (const char of buffer.toString()) {
    if (char === "\u0003") {
      process.stdin.setRawMode(false);
      process.exit(1);
    }
    if (char === "\r" || char === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (password.length < 16 || password.length > 256) {
        console.error("\nUse 16–256 characters.");
        process.exit(1);
      }
      const salt = randomBytes(16).toString("hex");
      console.log(
        "\nTRACE_PASSWORD_HASH=" +
          "scrypt:" +
          salt +
          ":" +
          scryptSync(password, salt, 64).toString("hex"),
      );
      process.exit(0);
    }
    if (char === "\u007f") password = password.slice(0, -1);
    else if (char >= " ") password += char;
  }
});
