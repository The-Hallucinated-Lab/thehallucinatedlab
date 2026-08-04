/* ============================================================
   ESLint — dev-only.

   The SITE still ships zero runtime dependencies: nothing in
   node_modules is served, bundled, or referenced by any page. This
   config exists so CI can catch the class of bug `node --check` cannot
   — an undeclared global, a shadowed binding, an unused variable left
   behind by an edit, a `==` that should be `===`.

   The rules below are deliberately strict about correctness and silent
   about style. Style is a matter of taste and this codebase is already
   internally consistent; a linter arguing about it just trains people
   to ignore the linter.
   ============================================================ */

const globals = require('globals');

/* Every function a page defines is a global to its sibling scripts,
   because these are plain <script> files rather than modules. Listing
   them means no-undef stays on — which is what actually catches typos
   and hallucinated identifiers. */
const SITE_GLOBALS = {
  // script.js
  CONFIG: 'readonly',
  shouldAnimate: 'readonly',
  initParticles: 'readonly',
  initNavbar: 'readonly',
  initScrollAnimations: 'readonly',
  initTypingEffect: 'readonly',
  startFeature: 'readonly',
  THL: 'writable',
  // toolkit.js
  THLToolkit: 'readonly',
  // nlp.js
  THLNlp: 'readonly',
  // vendored
  gsap: 'readonly',
  ScrollTrigger: 'readonly',
};

/* Two rules are deliberately OFF, because both fight the architecture
   rather than finding defects in it:

   no-var — toolkit.js, nlp.js and converter.js are written in ES5 style
   on purpose; nlp.js in particular is kept line-for-line comparable with
   its Python port in python/thehallucinatedlab/nlp/. Turning this on
   produced 155 findings, none of which was a bug, and the var->let
   autofix changes closure-capture semantics in loops. Churn with
   downside and no upside.

   no-implicit-globals — every page script defines top-level functions
   that sibling scripts call. That IS the design: plain <script> files,
   no module system, no bundler. It produced 44 findings that would each
   require wrapping a file in an IIFE. no-undef with the globals declared
   above already catches the thing that actually matters here — a typo'd
   or hallucinated identifier. */

const CORRECTNESS = {
  // The rules that catch real defects.
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'error',
  'no-shadow': 'error',
  'no-shadow-restricted-names': 'error',
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    caughtErrors: 'none',   // `catch (e) {}` with an unused binding is idiomatic here
  }],
  'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
  'no-undef': 'error',
  'no-param-reassign': 'error',
  'no-return-assign': 'error',
  'no-self-compare': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-constant-binary-expression': 'error',
  'no-promise-executor-return': 'error',
  'require-atomic-updates': 'error',
  'no-await-in-loop': 'off',   // the NDJSON reader legitimately awaits per chunk

  // Things the checklist calls out by name.
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-throw-literal': 'error',
  'prefer-promise-reject-errors': 'error',
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-console': 'off',         // console.warn/error is the only diagnostic channel on a static site
  'no-alert': 'error',
  'no-debugger': 'error',

  // Complexity guardrails.
  complexity: ['warn', 20],
  'max-depth': ['warn', 5],
};

module.exports = [
  {
    ignores: ['assets/vendor/**', 'node_modules/**', 'python/**'],
  },

  // Browser scripts.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...SITE_GLOBALS },
    },
    rules: CORRECTNESS,
  },

  // Node: tests, and the spec-sync script.
  {
    files: ['test/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: CORRECTNESS,
  },
];
