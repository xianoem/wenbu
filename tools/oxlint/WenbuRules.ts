import { Predicate } from 'effect'
import { definePlugin, defineRule, type ESTree } from 'vite-plus/lint/plugins'

type Node = ESTree.Node

const controlFlow = new Set([
  'IfStatement',
  'ReturnStatement',
  'ThrowStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'TryStatement',
  'SwitchStatement',
])

const comparisons = new Set(['===', '!==', '==', '!='])

const matchPatternMethods = new Set(['when', 'not', 'whenOr', 'whenAnd', 'tag'])

const unwrap = (node: Node): Node => {
  if (node.type === 'ParenthesizedExpression') {
    return unwrap(node.expression)
  }

  return node
}

const isTypeAssertion = (node: Node) =>
  node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion'

const isConstAssertion = (node: Node) =>
  isTypeAssertion(node) &&
  node.typeAnnotation.type === 'TSTypeReference' &&
  node.typeAnnotation.typeName.type === 'Identifier' &&
  node.typeAnnotation.typeName.name === 'const'

const isTagKey = (node: Node) =>
  (node.type === 'Identifier' && node.name === '_tag') ||
  (node.type === 'Literal' && node.value === '_tag')

const readsTag = (node: Node) => node.type === 'MemberExpression' && isTagKey(node.property)

const isMatchPattern = (node: Node) => {
  const parent = node.parent

  if (parent?.type !== 'CallExpression' || parent.callee.type !== 'MemberExpression') {
    return false
  }

  const { object, property } = parent.callee

  return (
    object.type === 'Identifier' &&
    object.name === 'Match' &&
    property.type === 'Identifier' &&
    matchPatternMethods.has(property.name)
  )
}

const isUnknownType = (node: Node): boolean => {
  if (node.type === 'TSUnknownKeyword') {
    return true
  }

  if (node.type === 'TSUnionType') {
    return node.types.some(isUnknownType)
  }

  return false
}

const predicateSubject = (node: Node) => {
  if (!('returnType' in node) || node.returnType === null || node.returnType === undefined) {
    return undefined
  }

  const returnType = node.returnType.typeAnnotation

  if (returnType.type !== 'TSTypePredicate' || returnType.parameterName.type !== 'Identifier') {
    return undefined
  }

  return returnType.parameterName.name
}

const parameterIdentifier = (parameter: Node) => {
  if (parameter.type === 'AssignmentPattern') {
    return parameterIdentifier(parameter.left)
  }

  return parameter.type === 'Identifier' ? parameter : undefined
}

const isMultiline = (node: Node) => node.loc.start.line !== node.loc.end.line

const declarations = new Set([
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
])

const isDeclaration = (node: Node): boolean => {
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
    return node.declaration !== null && isDeclaration(node.declaration)
  }

  return declarations.has(node.type)
}

export const noReexportOnlyModules = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow modules whose only job is re-exporting other modules.' },
    messages: {
      reexportOnly:
        'This module only re-exports. Import from the module that owns the code instead (no index.ts barrels).',
    },
  },
  createOnce(context) {
    return {
      Program(node) {
        const isReexportOnly =
          node.body.length > 0 &&
          node.body.every(
            (statement) =>
              statement.type === 'ExportAllDeclaration' ||
              (statement.type === 'ExportNamedDeclaration' && statement.source !== null),
          )

        if (isReexportOnly) {
          context.report({ node, messageId: 'reexportOnly' })
        }
      },
    }
  },
})

export const noTryCatch = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow try/catch in favor of typed Effect error channels.' },
    messages: {
      tryCatch:
        'Use Effect.try, Effect.tryPromise or a Schema.TaggedError instead of try/catch, so the failure is typed.',
    },
  },
  createOnce(context) {
    return {
      TryStatement(node) {
        context.report({ node, messageId: 'tryCatch' })
      },
    }
  },
})

const logFunctions = new Set([
  'log',
  'logTrace',
  'logDebug',
  'logInfo',
  'logWarning',
  'logError',
  'logFatal',
])

const isEffectMember = (node: Node, names: ReadonlySet<string>) =>
  node.type === 'MemberExpression' &&
  node.object.type === 'Identifier' &&
  node.object.name === 'Effect' &&
  node.property.type === 'Identifier' &&
  names.has(node.property.name)

const logLevelFunctions = new Set(['logWithLevel'])

const isLogCall = (node: Node) => {
  if (node.type !== 'CallExpression') {
    return false
  }

  const callee = unwrap(node.callee)

  if (isEffectMember(callee, logFunctions)) {
    return true
  }

  return callee.type === 'CallExpression' && isEffectMember(callee.callee, logLevelFunctions)
}

const isLogCallee = (node: Node) => {
  const callee = unwrap(node)

  if (isEffectMember(callee, logFunctions)) {
    return true
  }

  return (
    callee.type === 'ConditionalExpression' &&
    isEffectMember(unwrap(callee.consequent), logFunctions) &&
    isEffectMember(unwrap(callee.alternate), logFunctions)
  )
}

const isPlainString = (node: Node) =>
  (node.type === 'Literal' && Predicate.isString(node.value)) ||
  (node.type === 'TemplateLiteral' && node.expressions.length === 0)

export const logMessageLiteral = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a string literal as the message of an Effect log call, so user text never lands in a log message.',
    },
    messages: {
      literal:
        'Log a fixed message and put the values in Effect.annotateLogs; private ones there are hidden.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (!isLogCall(node) && !isLogCallee(node.callee)) {
          return
        }

        const [message] = node.arguments

        if (message === undefined || !isPlainString(message)) {
          context.report({ node, messageId: 'literal' })
        }
      },
    }
  },
})

export const noSwitch = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow switch statements in favor of exhaustive Match.' },
    messages: {
      switch: 'Use Match from effect, which is exhaustive and returns a value, instead of switch.',
    },
  },
  createOnce(context) {
    return {
      SwitchStatement(node) {
        context.report({ node, messageId: 'switch' })
      },
    }
  },
})

export const noModuleMocking = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow module mocking in favor of Layer seams.' },
    messages: {
      moduleMocking:
        'Do not mock modules. Give the code a Layer seam and provide a test implementation instead.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const callee = node.callee

        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') {
          return
        }

        const isMocker =
          callee.object.type === 'Identifier' && ['vi', 'jest'].includes(callee.object.name)

        const isMockCall = ['mock', 'doMock', 'unstable_mockModule'].includes(callee.property.name)

        if (isMocker && isMockCall) {
          context.report({ node, messageId: 'moduleMocking' })
        }
      },
    }
  },
})

export const noSchemaStore = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow KeyValueStore.toSchemaStore in favor of SettingsStore.make.' },
    messages: {
      schemaStore:
        "Use SettingsStore.make: a value saved before a field was added no longer decodes with toSchemaStore, and the user's saved settings reset.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const callee = node.callee

        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'toSchemaStore'
        ) {
          context.report({ node, messageId: 'schemaStore' })
        }
      },
    }
  },
})

export const noChainedTypeAssertions = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow casting through another type, such as `as unknown as T`.' },
    messages: {
      chained:
        'Do not cast through another type. Decode the value with a Schema or fix the source type.',
    },
  },
  createOnce(context) {
    const check = (node: Node) => {
      if (!isTypeAssertion(node) || isConstAssertion(node)) {
        return
      }

      const inner = unwrap(node.expression)

      if (isTypeAssertion(inner) && !isConstAssertion(inner)) {
        context.report({ node, messageId: 'chained' })
      }
    }

    return { TSAsExpression: check, TSTypeAssertion: check }
  },
})

export const requireSafetyComment = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Require a `SAFETY:` comment explaining every type assertion.' },
    messages: {
      missingSafety:
        'Explain why this cast is sound in a `// SAFETY:` comment on the lines just above it.',
    },
  },
  createOnce(context) {
    const check = (node: Node) => {
      if (isConstAssertion(node)) {
        return
      }

      const line = node.loc.start.line

      const isExplained = context.sourceCode
        .getAllComments()
        .some(
          (comment) =>
            comment.value.includes('SAFETY:') &&
            comment.range[1] <= node.range[0] &&
            comment.loc.end.line >= line - 3,
        )

      if (!isExplained) {
        context.report({ node, messageId: 'missingSafety' })
      }
    }

    return { TSAsExpression: check, TSTypeAssertion: check }
  },
})

export const noManualTagComparison = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow comparing `_tag` by hand.' },
    messages: {
      tagComparison:
        'Do not compare `_tag` by hand. Use Effect.catchTag, Match.tag or Predicate.isTagged.',
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        if (!comparisons.has(node.operator)) {
          return
        }

        if (readsTag(node.left) || readsTag(node.right)) {
          context.report({ node, messageId: 'tagComparison' })
        }
      },
    }
  },
})

export const noManualTaggedConstruction = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow building tagged values from object literals.' },
    messages: {
      taggedConstruction:
        'Do not build tagged values by hand. Use a Schema.TaggedError, Schema.TaggedClass or Data.taggedEnum constructor.',
    },
  },
  createOnce(context) {
    return {
      ObjectExpression(node) {
        const hasTag = node.properties.some(
          (property) => property.type === 'Property' && isTagKey(property.key),
        )

        if (hasTag && !isMatchPattern(node)) {
          context.report({ node, messageId: 'taggedConstruction' })
        }
      },
    }
  },
})

export const noRuntimeTypeof = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow ad-hoc `typeof` checks.' },
    messages: {
      typeof: 'Use a Predicate helper (Predicate.isString) or decode the value with a Schema.',
    },
  },
  createOnce(context) {
    return {
      UnaryExpression(node) {
        if (node.operator === 'typeof' && node.parent?.type === 'BinaryExpression') {
          context.report({ node: node.parent, messageId: 'typeof' })
        }
      },
    }
  },
})

export const noUnknownParameters = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow `unknown` parameters outside type predicates and `cause`.' },
    messages: {
      unknownParameter:
        'Parameter `{{name}}` takes unparsed input. Decode it with a Schema at the boundary and accept the decoded type.',
    },
  },
  createOnce(context) {
    const check = (node: Node) => {
      if (!('params' in node)) {
        return
      }

      const subject = predicateSubject(node)

      for (const parameter of node.params) {
        const identifier = parameterIdentifier(parameter)
        const annotation = identifier?.typeAnnotation?.typeAnnotation

        if (identifier === undefined || annotation === undefined || !isUnknownType(annotation)) {
          continue
        }

        if (identifier.name === 'cause' || identifier.name === subject) {
          continue
        }

        context.report({
          node: parameter,
          messageId: 'unknownParameter',
          data: { name: identifier.name },
        })
      }
    }

    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
      TSFunctionType: check,
      TSMethodSignature: check,
    }
  },
})

export const requireBlankLines = defineRule({
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description:
        'Require a blank line before control flow, around multi-line statements, and between declarations and actions, so code reads in short steps.',
    },
    messages: {
      blankLine: 'Add a blank line before this statement.',
    },
  },
  createOnce(context) {
    const check = (node: Node) => {
      if (!('body' in node) || !Array.isArray(node.body)) {
        return
      }

      const statements: ReadonlyArray<Node> = node.body

      statements.forEach((current, index) => {
        const previous = statements[index - 1]

        if (previous === undefined) {
          return
        }

        if (previous.type === 'ImportDeclaration' && current.type === 'ImportDeclaration') {
          return
        }

        const needsBlank =
          controlFlow.has(current.type) ||
          isMultiline(previous) ||
          isMultiline(current) ||
          isDeclaration(previous) !== isDeclaration(current)

        if (!needsBlank) {
          return
        }

        const firstComment = context.sourceCode.getCommentsBefore(current)[0]
        const topLine = (firstComment ?? current).loc.start.line
        const previousEnd = previous.loc.end.line

        if (topLine <= previousEnd || topLine - previousEnd >= 2) {
          return
        }

        const lineStart = context.sourceCode.getIndexFromLoc({ line: topLine, column: 0 })

        context.report({
          node: current,
          messageId: 'blankLine',
          fix: (fixer) => fixer.insertTextBeforeRange([lineStart, lineStart], '\n'),
        })
      })
    }

    return { Program: check, BlockStatement: check, StaticBlock: check }
  },
})

export default definePlugin({
  meta: { name: 'wenbu' },
  rules: {
    'no-reexport-only-modules': noReexportOnlyModules,
    'no-try-catch': noTryCatch,
    'log-message-literal': logMessageLiteral,
    'no-switch': noSwitch,
    'no-module-mocking': noModuleMocking,
    'no-schema-store': noSchemaStore,
    'no-chained-type-assertions': noChainedTypeAssertions,
    'require-safety-comment': requireSafetyComment,
    'no-manual-tag-comparison': noManualTagComparison,
    'no-manual-tagged-construction': noManualTaggedConstruction,
    'no-runtime-typeof': noRuntimeTypeof,
    'no-unknown-parameters': noUnknownParameters,
    'require-blank-lines': requireBlankLines,
  },
})
