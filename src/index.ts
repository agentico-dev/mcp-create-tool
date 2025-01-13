#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import ejs from "ejs";
import fs from "fs/promises";
import { input, confirm } from '@inquirer/prompts';
import ora from "ora";
import os from "os";
import path from "path";
import { exec } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from "url";
import { ExitPromptError } from "@inquirer/core";
import isWsl from 'is-wsl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function getClaudeConfigDir(): Promise<string> {
  if (isWsl) {
    // C:\Users\<USER>\AppData\Roaming\Claude\claude_desktop_config.json
    // converting Windows to WSL: https://superuser.com/a/1340707/1223497
    const winHome = await executeCommand("wslpath $(cmd.exe /C \"echo %USERPROFILE%\" 2>/dev/null | tr -d '\\r\\n')");
    return path.join(
      // remove trailing newline
      winHome.trim(),
      "AppData",
      "Roaming",
      "Claude",
    );
  }
  switch (os.platform()) {
    case "darwin":
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Claude",
      );
    case "win32":
      if (!process.env.APPDATA) {
        throw new Error("APPDATA environment variable is not set");
      }
      return path.join(process.env.APPDATA, "Claude");
    default:
      throw new Error(
        `Unsupported operating system for Claude configuration: ${os.platform()}`,
      );
  }
}

const execAsync = promisify(exec)
export async function executeCommand(command: string): Promise<any> {
  const { stdout, stderr } = await execAsync(command)
  if (stderr) {
    console.error(`Error executing ${command}: ${stderr}`)
    throw new Error(stderr)
  }
  return stdout
}

async function updateClaudeConfig(name: string, directory: string) {
  try {
    const configFile = path.join(
      await getClaudeConfigDir(),
      "claude_desktop_config.json",
    );
    console.log(`Updating Claude.app configuration in ${configFile}`);
    let networkDirectory = '';
    if (isWsl) {
      // We need to add the WSL and Linux path to the Windows path
      const wslNetworkHome = await executeCommand('cat /etc/os-release | grep -e "^NAME=" | sed "s/NAME=//g" | tr -d \\"');
      networkDirectory = '//' + path.join(
        "wsl.localhost",
        wslNetworkHome.trim()
      );
    }

    let config;
    try {
      config = JSON.parse(await fs.readFile(configFile, "utf-8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }

      // File doesn't exist, create initial config
      config = {};
      await fs.mkdir(path.dirname(configFile), { recursive: true });
    }

    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    if (config.mcpServers[name]) {
      const replace = await confirm(
        {
          message: `An MCP server named "${name}" is already configured for Claude.app. Do you want to replace it?`,
          default: false,
        },
      );
      if (!replace) {
        console.log(
          chalk.yellow(
            `Skipped replacing Claude.app config for existing MCP server "${name}"`,
          ),
        );
        return;
      }
    }
    config.mcpServers[name] = {
      command: "node",
      args: [ networkDirectory + path.resolve(directory, "build", "index.js")],
    };

    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    console.log(
      chalk.green("✅ Successfully added MCP server to Claude.app configuration"),
    );
  } catch {
    console.log(chalk.yellow("⚠️ Note: Could not update Claude.app configuration"));
  }
}

async function createServer(directory: string, options: any = {}) {
  // Check if directory already exists
  try {
    await fs.access(directory);
    console.log(chalk.red(`Error: Directory '${directory}' already exists.`));
    process.exit(1);
  } catch (err) {
    // Directory doesn't exist, we can proceed
  }

  const questions: Questions = {
    name: {
      message: "What is the name of your MCP server?",
      default: path.basename(directory),
      required: !options.name,
    },
    description: {
      message: "What is the description of your server's tool?",
      default: options.description ? options.description : "A Model Context Protocol server",
      required: !options.description,
    },
    tool: {
      message: "What is the name of the tool to create?",
      default: options.tool ? options.tool : path.basename(directory),
      required: !options.tool,
    },
    installForClaude: {
      message: "Would you like to install this server for Claude.app?",
      required: false,
    }
  };

  interface Question {
    message: string;
    default?: string;
    required?: boolean;
  }

  interface Questions {
    name: Question;
    description: Question;
    tool: Question;
    installForClaude: Question;
  }

  const answersInquirer = async (questions: Questions): Promise<any> => {
    const name = await input({ ...questions.name, validate: (value) => value.length > 3 || 'Name must be at least 4 characters' });
    const description = await input(questions.description);
    const tool = await input({
      ...questions.tool,
      // trim all whitespace from the input
      transformer(value) {
        return value.trim();
      }
    });
    const installForClaude = isWsl || os.platform() === "darwin" || os.platform() === "win32" ? await confirm({
      message: "Would you like to install this server for Claude.app?",
      default: true
    }) : false;
    console.debug({ name, description, tool, installForClaude });
    return { name, description, tool, installForClaude };
  };

  const answers = await answersInquirer(questions);
  const { name, description, tool, installForClaude } = answers;

  const config = {
    name: options.name || name,
    description: options.description || description,
    tool: options.tool || tool,
    installForClaude: options.installForClaude || installForClaude
  };

  const spinner = ora("Creating MCP server...").start();

  try {
    // Create project directory
    await fs.mkdir(directory);

    // Copy template files
    const templateDir = path.join(__dirname, "../template");
    const files = await fs.readdir(templateDir, { recursive: true });

    for (const file of files) {
      const sourcePath = path.join(templateDir, file);
      const stats = await fs.stat(sourcePath);

      if (!stats.isFile()) continue;

      // Special handling for dot files - remove the leading dot from template name
      const targetPath = path.join(
        directory,
        file.startsWith('dotfile-')
          ? `.${file.slice(8).replace('.ejs', '')}`
          : file.replace('.ejs', '')
      );
      const targetDir = path.dirname(targetPath);

      // Create subdirectories if needed
      await fs.mkdir(targetDir, { recursive: true });

      // Read and process template file
      let content = await fs.readFile(sourcePath, "utf-8");

      // Use EJS to render the template
      content = ejs.render(content, config);

      // Write processed file
      await fs.writeFile(targetPath, content);
    }

    spinner.succeed(chalk.green("MCP server created successfully!"));

    if (answers.installForClaude) {
      await updateClaudeConfig(config.name, directory);
    }

    // Print next steps
    console.log("\nNext steps:");
    console.log(chalk.cyan(`  cd ${directory}`));
    console.log(chalk.cyan("  npm install"));
    console.log(
      chalk.cyan(`  npm run build  ${chalk.reset("# or: npm run watch")}`),
    );
    console.log(
      chalk.cyan(
        `  npm link       ${chalk.reset("# optional, to make available globally")}\n`,
      ),
    );
    console.log(chalk.yellow("Test it in your browser:"));
    console.log(chalk.cyan("  npm run inspector\n"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to create MCP server"));
    console.error(error);
    process.exit(1);
  }
}

// detect ctrl+c and exit
process.on("SIGINT", () => {
  console.log(chalk.yellow("\nAborted."));
  process.exit(0);
});

try {
  const program = new Command()
    .name("mcp-create-tool")
    .description("Create a new Agentico MCP Tool (with server)")
    .argument("<directory>", "Directory to create the server in")
    .option("-n, --name <name>", "Name of the server")
    .option("-d, --description <description>", "Description of the server")
    .option("-t, --tool <tool>", "Name of the tool to create")
    .action(createServer);

  program.showHelpAfterError('(add --help for additional information)');
  await program.parseAsync();
}
catch (error) {
  if (error instanceof ExitPromptError) {
    console.log(chalk.yellow("\nAborted by user."));
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
}
