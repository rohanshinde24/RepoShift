import test from "node:test";
import assert from "node:assert/strict";
import { sandboxFlags, resolveImage } from "../../src/runner.js";
import { command } from "../../src/core.js";
test(
  "sandbox runs non-root with read-only root and blocked egress",
  { timeout: 30000 },
  async () => {
    const image = await resolveImage();
    const script = `const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');assert.equal(process.getuid(),1000);assert.equal(fs.existsSync('/var/run/docker.sock'),false);assert.throws(()=>fs.writeFileSync('/escape','bad'));assert.equal(process.env.AZURE_OPENAI_API_KEY,undefined);const socket=net.connect({host:'1.1.1.1',port:80});socket.on('connect',()=>{console.error('Unexpected egress');process.exit(1)});socket.on('error',()=>process.exit(0));setTimeout(()=>{socket.destroy();process.exit(0)},1000);`;
    const result = await command(
      "docker",
      [
        "run",
        "--rm",
        ...sandboxFlags,
        "--entrypoint",
        "node",
        image,
        "-e",
        script,
      ],
      { timeout: 15000 },
    );
    assert.equal(result.code, 0, result.output);
  },
);
