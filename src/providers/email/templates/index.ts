import { hideBin } from "yargs/helpers";
import * as path from "path";
import { fileURLToPath } from "node:url";
import yargs from "yargs";
import * as fs from "fs";
import { FILE_OUTPUT_TYPE, SES_ACTIONS } from "@/enums";
import { AwsSesProvider } from "@/providers/email/ses.provider";

// ESM has no __dirname — reconstruct it from this module's own URL so the
// template-file lookups below resolve relative to this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const awsEmailService = new AwsSesProvider();

// Define the yargs command and options
const argv = yargs(hideBin(process.argv))
  .version("1.0.0")
  .alias("v", "version")
  .help()
  .alias("h", "help")
  .option("template", {
    alias: "t",
    describe: "Template JSON file to load",
    type: "string",
    demandOption: true, // Make the template argument required
  })
  .option("action", {
    alias: "a",
    describe: "Action to perform on the template (create/update)",
    type: "string",
    demandOption: true, // Make the action argument required
    choices: ["create", "update", "delete"],
  })
  .fail((msg, err) => {
    // Handle errors here and show custom messages
    if (err) {
      console.error(`Custom Error: ${err.message}`);
    } else {
      console.error(`Custom Error: ${msg}`);
    }
    console.log(
      "Usage: npm run ses-push -- --template <template-file> --action <create|update|delete>",
    );
    process.exit(1);
  }).argv;

const findFiles = (params: { fileName: string; dir: string; mode: string }) => {
  const file = path.join(__dirname, params.dir, String(params.fileName));

  if (!fs.existsSync(file)) {
    throw new Error(`File ${params.fileName} not found.`);
  }

  let data;

  switch (params.mode) {
    case FILE_OUTPUT_TYPE.JSON:
      data = JSON.parse(fs.readFileSync(file, "utf-8"));
      break;
    case FILE_OUTPUT_TYPE.STRING:
      data = String(fs.readFileSync(file, "utf-8"));
      break;
  }

  return data;
};

const findMetaData = (fileName: string) => {
  const metaData = findFiles({
    dir: "meta",
    fileName: fileName,
    mode: FILE_OUTPUT_TYPE.JSON,
  });

  if (!metaData.TemplateFile) {
    return metaData;
  }

  const viewData = findFiles({
    dir: "views",
    fileName: metaData.TemplateFile,
    mode: FILE_OUTPUT_TYPE.STRING,
  });

  if (viewData) {
    fs.writeFileSync(
      path.join(__dirname, "meta", String(fileName)),
      JSON.stringify({ ...metaData, HtmlPart: viewData }),
      "utf8",
    );
  }

  return { ...metaData, HtmlPart: viewData };
};

const main = async () => {
  try {
    const { template, action } = argv as { template: string; action: string };

    switch (action) {
      case SES_ACTIONS.CREATE:
        await awsEmailService.createTemplate({
          Template: findMetaData(template),
        });
        break;
      case SES_ACTIONS.UPDATE:
        await awsEmailService.updateTemplate({
          Template: findMetaData(template),
        });
        break;
      case SES_ACTIONS.DELETE:
        await awsEmailService.deleteTemplate(String(template));
        break;
    }

    console.log(
      `\x1b[32mTemplate got ${action}d successfully with the name : ${template}`,
    );
  } catch (error) {
    console.error("Error processing template:", error);
  }
};

main();
