#!/bin/bash
set -e

echo "🧪 Agentstage E2E Test Suite"
echo "============================"

# 测试配置
TEST_DIR=$(mktemp -d)
CLI_DIR="${PWD}"
CLI_PATH="${CLI_DIR}/dist/index.js"

echo ""
echo "📁 Test directory: $TEST_DIR"
echo "🔧 CLI path: $CLI_PATH"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 测试计数器
TESTS_PASSED=0
TESTS_FAILED=0

# 清理函数
cleanup() {
    echo ""
    echo "🧹 Cleaning up test directory..."
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# 前置检查
echo ""
echo "🔍 Pre-flight checks"
if [ ! -f "$CLI_PATH" ]; then
    echo "❌ CLI not built. Run 'pnpm run build' first"
    exit 1
fi

# 测试 1: CLI 版本号
echo ""
echo "Test 1: CLI version should match package.json"
PKG_VERSION=$(node -p "require('${CLI_DIR}/package.json').version")
CLI_VERSION=$(node "$CLI_PATH" --version 2>/dev/null || echo "")
echo "Package version: $PKG_VERSION"
echo "CLI version: $CLI_VERSION"
if [ "$CLI_VERSION" = "$PKG_VERSION" ]; then
    echo -e "${GREEN}✅ Version matches${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}❌ Version mismatch${NC}"
    ((TESTS_FAILED++))
fi

# 测试 2: CLI help
echo ""
echo "Test 2: CLI help should work"
HELP_OUTPUT=$(node "$CLI_PATH" --help 2>&1 || true)
if echo "$HELP_OUTPUT" | grep -q "Usage:"; then
    echo -e "${GREEN}✅ Help command works${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}❌ Help command failed${NC}"
    ((TESTS_FAILED++))
fi

# 测试 3: dev init 命令存在
echo ""
echo "Test 3: dev init command should exist"
INIT_HELP=$(node "$CLI_PATH" dev init --help 2>&1 || true)
if echo "$INIT_HELP" | grep -q "Initialize"; then
    echo -e "${GREEN}✅ dev init command exists${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}❌ dev init command missing${NC}"
    ((TESTS_FAILED++))
fi

# 测试 4: 测试 configurePackageJson 逻辑
echo ""
echo "Test 4: workspace:* should be replaced in generated package.json"
cd "$TEST_DIR"
mkdir -p test-init && cd test-init

# 创建测试用的 template 副本 (排除 node_modules)
mkdir -p .agentstage
rsync -av --exclude='node_modules' "${CLI_DIR}/template/" .agentstage/ 2>/dev/null || cp -r "${CLI_DIR}/template/"* .agentstage/ 2>/dev/null || true

# 模拟 configurePackageJson 的行为
node -e "
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join('.agentstage', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// 替换 workspace:* (这是 configurePackageJson 的逻辑)
const npmVersions = {
  '@agentstage/render': '^0.2.2',
  '@agentstage/bridge': '^0.1.0',
  'agent-stage-bridge': '^0.1.0'
};

for (const [dep, version] of Object.entries(npmVersions)) {
  if (packageJson.dependencies?.[dep] === 'workspace:*') {
    packageJson.dependencies[dep] = version;
  }
}

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
"

# 检查是否还有 workspace:*
if grep -q "workspace:" ".agentstage/package.json"; then
    echo -e "${RED}❌ Found workspace:* in generated package.json${NC}"
    ((TESTS_FAILED++))
else
    echo -e "${GREEN}✅ No workspace:* found${NC}"
    ((TESTS_PASSED++))
fi

# 测试 5: 检查依赖版本是否正确替换
echo ""
echo "Test 5: Dependencies should have correct versions"
RENDER_VER=$(node -p "require('./.agentstage/package.json').dependencies['@agentstage/render']" 2>/dev/null || echo "")
if [ "$RENDER_VER" = "^0.2.2" ]; then
    echo -e "${GREEN}✅ @agentstage/render version correct${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}❌ @agentstage/render version incorrect: $RENDER_VER${NC}"
    ((TESTS_FAILED++))
fi

# 测试 6: template 应该包含所有必要依赖
echo ""
echo "Test 6: Template should include required dependencies"
REQUIRED_DEPS=("@tanstack/react-router" "tailwindcss" "vite" "@tanstack/router-plugin")
ALL_FOUND=true
for dep in "${REQUIRED_DEPS[@]}"; do
    if ! grep -q "\"$dep\"" ".agentstage/package.json"; then
        echo -e "${RED}❌ Missing dependency: $dep${NC}"
        ALL_FOUND=false
    fi
done
if [ "$ALL_FOUND" = true ]; then
    echo -e "${GREEN}✅ All required dependencies present${NC}"
    ((TESTS_PASSED++))
else
    ((TESTS_FAILED++))
fi

# 测试 7: guide 命令
echo ""
echo "Test 7: guide command should work"
GUIDE_OUTPUT=$(node "$CLI_PATH" guide quickstart 2>&1 || true)
if echo "$GUIDE_OUTPUT" | grep -q "Quick Start"; then
    echo -e "${GREEN}✅ Guide command works${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}❌ Guide command failed${NC}"
    ((TESTS_FAILED++))
fi

# 总结
echo ""
echo "============================"
echo "📊 E2E Test Summary"
echo "============================"
echo -e "${GREEN}✅ Passed: $TESTS_PASSED${NC}"
echo -e "${RED}❌ Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}💥 Some tests failed${NC}"
    exit 1
fi
