export default {
  "**/*.{ts,mts}": () => "tsc --noEmit -p tsconfig.json",
  "**/*.{ts,mts,js,mjs}": [
    "eslint --no-warn-ignored",
    "prettier --ignore-path .gitignore --write",
  ],
  "**/*.{json,md}": ["prettier --ignore-path .gitignore --write"],
};
