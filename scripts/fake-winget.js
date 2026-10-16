// A stand-in for winget.exe, used only by scripts/test.js:  node fake-winget.js <behaviour> [arg]
const [, , behaviour, arg] = process.argv;
if (behaviour === "out") { process.stdout.write(String(arg) + "\n"); process.exit(0); }
else if (behaviour === "fail") { process.stderr.write("something failed\n"); process.exit(Number(arg) || 1); }
else if (behaviour === "spam") { process.stdout.write("x".repeat(Number(arg) || 1000)); process.exit(0); }
else if (behaviour === "hang") { process.stdout.write("started\n"); setInterval(() => {}, 1000); }
else process.exit(0);
