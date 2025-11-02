# Check PR Conflicts Action

A TypeScript GitHub Action to automatically check pull requests for merge conflicts and manage conflict labels.

## Features

- 🔍 Automatically detects merge conflicts in pull requests
- 🏷️ Adds/removes configurable conflict labels
- ⚡ Smart filtering based on trigger events (PR sync, merge, scheduled)
- 🔄 Retry mechanism for GitHub's mergeable state calculation
- 📝 Comprehensive logging and error handling
- ✅ Full TypeScript support with 98%+ test coverage

## Usage

### Basic Usage

Add this action to your workflow to automatically check for conflicts:

```yaml
name: Check PR Conflicts
on:
  pull_request:
    types: [opened, synchronize, reopened]
  pull_request_target:
    types: [opened, synchronize, reopened]

jobs:
  check-conflicts:
    runs-on: ubuntu-latest
    steps:
      - name: Check for merge conflicts
        uses: ./.github/actions/check-pr-conflicts
        with:
          github-token: ${{ github.token }}
```

### Advanced Usage with Custom Configuration

```yaml
name: Comprehensive Conflict Check
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
  pull_request_target:
    types: [opened, synchronize, reopened, closed]
  schedule:
    # Run every hour to check all open PRs
    - cron: '0 * * * *'

jobs:
  check-conflicts:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Check for merge conflicts
        uses: ./.github/actions/check-pr-conflicts
        with:
          github-token: ${{ github.token }}
          conflict-label: 'merge-conflicts'
          max-retries: 15
          retry-delay: 3000
```

### Workflow Triggers Explained

#### Pull Request Events
- **`opened`** - When a new PR is created
- **`synchronize`** - When commits are pushed to the PR branch
- **`reopened`** - When a closed PR is reopened
- **`closed`** - When a PR is closed/merged (checks other PRs targeting same base)

#### Scheduled Events
- **`schedule`** - Periodic checks of all open PRs (useful for detecting conflicts from merged PRs)

### Input Parameters

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | *none* |
| `conflict-label` | Label to add when conflicts are found | No | `conflicts` |
| `max-retries` | Maximum retries for mergeable state | No | `10` |
| `retry-delay` | Delay between retries (milliseconds) | No | `5000` |

### Behavior

The action intelligently determines what to check based on the trigger:

1. **PR Synchronize**: Checks only the current PR
2. **PR Closed + Merged**: Checks all PRs targeting the same base branch
3. **Scheduled/Other Events**: Checks all open PRs

### Examples by Use Case

#### 1. Simple Conflict Detection
```yaml
- name: Check conflicts
  uses: ./.github/actions/check-pr-conflicts
  with:
    github-token: ${{ github.token }}
```

#### 2. Custom Conflict Label
```yaml
- name: Check conflicts with custom label
  uses: ./.github/actions/check-pr-conflicts
  with:
    github-token: ${{ github.token }}
    conflict-label: 'needs-rebase'
```

#### 3. Aggressive Checking (Fast Retries)
```yaml
- name: Quick conflict check
  uses: ./.github/actions/check-pr-conflicts
  with:
    github-token: ${{ github.token }}
    max-retries: 20
    retry-delay: 1000
```

#### 4. Conservative Checking (Slow Retries)
```yaml
- name: Patient conflict check
  uses: ./.github/actions/check-pr-conflicts
  with:
    github-token: ${{ github.token }}
    max-retries: 5
    retry-delay: 10000
```

### Multi-Repository Setup

For organizations wanting to use this across multiple repositories:

```yaml
# In each repository's workflow
- name: Check conflicts
  uses: vyos/.github/.github/actions/check-pr-conflicts@main
  with:
    github-token: ${{ github.token }}
```

### Required Permissions

Ensure your workflow has the necessary permissions:

```yaml
permissions:
  contents: read        # To read repository content
  pull-requests: write  # To read PR details
  issues: write        # To add/remove labels
```

## Development

## Development

### Building the Action

This action is written in TypeScript and needs to be built before use:

```bash
cd .github/actions/check-pr-conflicts
npm install
npm run build-and-package
```

This will:
1. Compile TypeScript source to JavaScript (`lib/`)
2. Bundle all dependencies into a single file (`dist/index.js`)

### Development Scripts

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Build and watch for changes
npm run build:watch

# Package for distribution
npm run package

# Build and package in one step
npm run build-and-package

# Run linting
npm run lint
npm run lint:fix

# Run tests
npm run test
npm run test:watch
npm run test:coverage

# Clean build artifacts
npm run clean
```

### Project Structure

```
src/
├── index.ts              # Main TypeScript source
__tests__/               # Test files
├── functions.test.ts        # Unit tests
├── integration.test.ts      # Integration tests
├── index.test.ts           # Component tests
├── test-utils.ts           # Test utilities
├── setup.ts                # Jest setup
└── __mocks__/              # Mock implementations
    └── @actions/           # GitHub Actions mocks
tsconfig.json            # TypeScript configuration
.eslintrc.js            # ESLint configuration
jest.config.js          # Jest test configuration
lib/                    # Compiled JavaScript (gitignored)
dist/                   # Bundled distribution files
├── index.js            # Final bundled action (committed)
├── index.js.map        # Source map
└── licenses.txt        # Dependency licenses
```

### Test Coverage

The action has comprehensive test coverage:
- ✅ **98%+ Statement Coverage**
- ✅ **49 Test Cases**
- ✅ Unit, Integration, and End-to-End tests
- ✅ Mock GitHub API interactions
- ✅ Error scenario testing

### What Gets Committed

- ✅ `dist/index.js` (bundled action)
- ✅ `dist/index.js.map` (source map)
- ✅ `dist/licenses.txt` (dependency licenses)
- ✅ Source files (`src/`, `action.yml`, `package.json`, etc.)
- ❌ `node_modules/` (ignored)
- ❌ `lib/` (ignored - intermediate build output)

### Development Workflow

1. Make changes to TypeScript files in `src/`
2. Run `npm run test` to ensure tests pass
3. Run `npm run build-and-package` to build and bundle
4. Commit the updated `dist/` files
5. Test the action in workflows

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Ensure all tests pass (`npm test`)
5. Build and package (`npm run build-and-package`)
6. Submit a pull request

## Type Safety

This action is fully typed with TypeScript, providing:
- Compile-time error checking
- IntelliSense support in IDEs
- Better refactoring capabilities
- Clear interface definitions

## License

MIT License - see LICENSE file for details.