import { buildMappings, Segment, SourceMap, toString } from '@volar/source-map';
import type { SFCBlock } from '@vue/compiler-sfc';
import { VueLanguagePlugin } from '../types';
import { parse } from '../utils/parseSfc';

const codeblockReg = /```[\s\S]+?```/g;
const inlineCodeblockReg = /`[^\n`]+?`/g;
const scriptSetupReg = /\\\<[\s\S]+?\>\n?/g;
const sfcBlockReg = /\<(script|style)\b[\s\S]*?\>([\s\S]*?)\<\/\1\>/g;
const angleBracketReg = /\<\S*\:\S*\>/g;
const linkReg = /\[[\s\S]*?\]\([\s\S]*?\)/g;

const plugin: VueLanguagePlugin = () => {

	return {

		version: 1,

		parseSFC(fileName, content) {

			if (fileName.endsWith('.md')) {

				content = content
					// code block
					.replace(codeblockReg, match => '```' + ' '.repeat(match.length - 6) + '```')
					// inline code block
					.replace(inlineCodeblockReg, match => `\`${' '.repeat(match.length - 2)}\``)
					// # \<script setup>
					.replace(scriptSetupReg, match => ' '.repeat(match.length));

				const codes: Segment[] = [];

				for (const match of content.matchAll(sfcBlockReg)) {
					if (match.index !== undefined) {
						const matchText = match[0];
						codes.push([matchText, undefined, match.index]);
						codes.push('\n\n');
						content = content.substring(0, match.index) + ' '.repeat(matchText.length) + content.substring(match.index + matchText.length);
					}
				}

				content = content
					// angle bracket: <http://foo.com>
					.replace(angleBracketReg, match => ' '.repeat(match.length))
					// [foo](http://foo.com)
					.replace(linkReg, match => ' '.repeat(match.length));

				codes.push('<template>\n');
				codes.push([content, undefined, 0]);
				codes.push('\n</template>');

				const file2VueSourceMap = new SourceMap(buildMappings(codes));
				const sfc = parse(toString(codes));

				if (sfc.descriptor.template) {
					transformRange(sfc.descriptor.template);
				}
				if (sfc.descriptor.script) {
					transformRange(sfc.descriptor.script);
				}
				if (sfc.descriptor.scriptSetup) {
					transformRange(sfc.descriptor.scriptSetup);
				}
				for (const style of sfc.descriptor.styles) {
					transformRange(style);
				}
				for (const customBlock of sfc.descriptor.customBlocks) {
					transformRange(customBlock);
				}

				return sfc;

				function transformRange(block: SFCBlock) {
					block.loc.start.offset = file2VueSourceMap.toSourceOffset(block.loc.start.offset)?.[0] ?? -1;
					block.loc.end.offset = file2VueSourceMap.toSourceOffset(block.loc.end.offset)?.[0] ?? -1;
				}
			};
		}
	};
};

export default plugin;
