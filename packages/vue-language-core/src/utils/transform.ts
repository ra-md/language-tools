import { isGloballyWhitelisted } from '@vue/shared';
import type * as ts from 'typescript/lib/tsserverlibrary';
import { VueCompilerOptions } from '../types';

export function walkInterpolationFragment(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	code: string,
	ast: ts.SourceFile,
	cb: (fragment: string, offset: number | undefined, isJustForErrorMapping?: boolean) => void,
	localVars: Record<string, number>,
	identifiers: Set<string>,
	vueOptions: VueCompilerOptions,
) {

	let ctxVars: {
		text: string,
		isShorthand: boolean,
		offset: number,
	}[] = [];

	const varCb = (id: ts.Identifier, isShorthand: boolean) => {
		if (
			!!localVars[id.text] ||
			// https://github.com/vuejs/core/blob/245230e135152900189f13a4281302de45fdcfaa/packages/compiler-core/src/transforms/transformExpression.ts#L342-L352
			isGloballyWhitelisted(id.text) ||
			id.text === 'require' ||
			id.text.startsWith('__VLS_')
		) {
			// localVarOffsets.push(localVar.getStart(ast));
		}
		else {
			ctxVars.push({
				text: id.text,
				isShorthand: isShorthand,
				offset: id.getStart(ast),
			});
			identifiers.add(id.text);
		}
	};
	ast.forEachChild(node => walkIdentifiers(ts, node, varCb, localVars));

	ctxVars = ctxVars.sort((a, b) => a.offset - b.offset);

	if (ctxVars.length) {

		if (ctxVars[0].isShorthand) {
			cb(code.substring(0, ctxVars[0].offset + ctxVars[0].text.length), 0);
			cb(': ', undefined);
		}
		else {
			cb(code.substring(0, ctxVars[0].offset), 0);
		}

		for (let i = 0; i < ctxVars.length - 1; i++) {

			// fix https://github.com/vuejs/language-tools/issues/1205
			// fix https://github.com/vuejs/language-tools/issues/1264
			cb('', ctxVars[i + 1].offset, true);
			if (vueOptions.experimentalUseElementAccessInTemplate) {
				const varStart = ctxVars[i].offset;
				const varEnd = ctxVars[i].offset + ctxVars[i].text.length;
				cb('__VLS_ctx[', undefined);
				cb('', varStart, true);
				cb("'", undefined);
				cb(code.substring(varStart, varEnd), varStart);
				cb("'", undefined);
				cb('', varEnd, true);
				cb(']', undefined);
				if (ctxVars[i + 1].isShorthand) {
					cb(code.substring(varEnd, ctxVars[i + 1].offset + ctxVars[i + 1].text.length), varEnd);
					cb(': ', undefined);
				}
				else {
					cb(code.substring(varEnd, ctxVars[i + 1].offset), varEnd);
				}
			}
			else {
				cb('__VLS_ctx.', undefined);
				if (ctxVars[i + 1].isShorthand) {
					cb(code.substring(ctxVars[i].offset, ctxVars[i + 1].offset + ctxVars[i + 1].text.length), ctxVars[i].offset);
					cb(': ', undefined);
				}
				else {
					cb(code.substring(ctxVars[i].offset, ctxVars[i + 1].offset), ctxVars[i].offset);
				}
			}
		}

		if (vueOptions.experimentalUseElementAccessInTemplate) {
			const varStart = ctxVars[ctxVars.length - 1].offset;
			const varEnd = ctxVars[ctxVars.length - 1].offset + ctxVars[ctxVars.length - 1].text.length;
			cb('__VLS_ctx[', undefined);
			cb('', varStart, true);
			cb("'", undefined);
			cb(code.substring(varStart, varEnd), varStart);
			cb("'", undefined);
			cb('', varEnd, true);
			cb(']', undefined);
			cb(code.substring(varEnd), varEnd);
		}
		else {
			cb('', ctxVars[ctxVars.length - 1].offset, true);
			cb('__VLS_ctx.', undefined);
			cb(code.substring(ctxVars[ctxVars.length - 1].offset), ctxVars[ctxVars.length - 1].offset);
		}
	}
	else {
		cb(code, 0);
	}

	return ctxVars;
}

function walkIdentifiers(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	node: ts.Node,
	cb: (varNode: ts.Identifier, isShorthand: boolean) => void,
	localVars: Record<string, number>,
	blockVars: string[] = [],
	isRoot: boolean = true,
) {

	if (ts.isIdentifier(node)) {
		cb(node, false);
	}
	else if (ts.isShorthandPropertyAssignment(node)) {
		cb(node.name, true);
	}
	else if (ts.isPropertyAccessExpression(node)) {
		walkIdentifiers(ts, node.expression, cb, localVars, blockVars, false);
	}
	else if (ts.isVariableDeclaration(node)) {

		colletVars(ts, node.name, blockVars);

		for (const varName of blockVars) {
			localVars[varName] = (localVars[varName] ?? 0) + 1;
		}

		if (node.initializer)
			walkIdentifiers(ts, node.initializer, cb, localVars, blockVars, false);
	}
	else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {

		const functionArgs: string[] = [];

		for (const param of node.parameters) {
			colletVars(ts, param.name, functionArgs);
			if (param.type) {
				walkIdentifiers(ts, param.type, cb, localVars, blockVars, false);
			}
		}

		for (const varName of functionArgs)
			localVars[varName] = (localVars[varName] ?? 0) + 1;

		walkIdentifiers(ts, node.body, cb, localVars, blockVars, false);

		for (const varName of functionArgs)
			localVars[varName]--;
	}
	else if (ts.isObjectLiteralExpression(node)) {
		for (const prop of node.properties) {
			if (ts.isPropertyAssignment(prop)) {
				// fix https://github.com/vuejs/language-tools/issues/1176
				if (ts.isComputedPropertyName(prop.name)) {
					walkIdentifiers(ts, prop.name.expression, cb, localVars, blockVars, false);
				}
				walkIdentifiers(ts, prop.initializer, cb, localVars, blockVars, false);
			}
			// fix https://github.com/vuejs/language-tools/issues/1156
			else if (ts.isShorthandPropertyAssignment(prop)) {
				walkIdentifiers(ts, prop, cb, localVars, blockVars, false);
			}
			// fix https://github.com/vuejs/language-tools/issues/1148#issuecomment-1094378126
			else if (ts.isSpreadAssignment(prop)) {
				// TODO: cannot report "Spread types may only be created from object types.ts(2698)"
				walkIdentifiers(ts, prop.expression, cb, localVars, blockVars, false);
			}
		}
	}
	else if (ts.isTypeReferenceNode(node)) {
		// fix https://github.com/vuejs/language-tools/issues/1422
		node.forEachChild(node => walkIdentifiersInTypeReference(ts, node, cb));
	}
	else {
		const _blockVars = blockVars;
		if (ts.isBlock(node)) {
			blockVars = [];
		}
		node.forEachChild(node => walkIdentifiers(ts, node, cb, localVars, blockVars, false));
		if (ts.isBlock(node)) {
			for (const varName of blockVars) {
				localVars[varName]--;
			}
		}
		blockVars = _blockVars;
	}

	if (isRoot) {
		for (const varName of blockVars) {
			localVars[varName]--;
		}
	}
}

function walkIdentifiersInTypeReference(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	node: ts.Node,
	cb: (varNode: ts.Identifier, isShorthand: boolean) => void,
) {
	if (ts.isTypeQueryNode(node) && ts.isIdentifier(node.exprName)) {
		cb(node.exprName, false);
	}
	else {
		node.forEachChild(node => walkIdentifiersInTypeReference(ts, node, cb));
	}
}

export function colletVars(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	node: ts.Node,
	result: string[],
) {
	if (ts.isIdentifier(node)) {
		result.push(node.text);
	}
	else if (ts.isObjectBindingPattern(node)) {
		for (const el of node.elements) {
			colletVars(ts, el.name, result);
		}
	}
	else if (ts.isArrayBindingPattern(node)) {
		for (const el of node.elements) {
			if (ts.isBindingElement(el)) {
				colletVars(ts, el.name, result);
			}
		}
	}
	else {
		node.forEachChild(node => colletVars(ts, node, result));
	}
}
