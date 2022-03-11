import { VueDocument } from '@volar/vue-typescript';
import * as vscode from 'vscode-languageserver-protocol';
import { EmbeddedLanguagePlugin } from '../utils/definePlugin';
import { hyphenate } from '@vue/shared';

export const convertTagNameCasingCommand = 'tagNameCasingConversions';

export type ConvertTagNameCasingCommandArgs = [
    string, // uri
    'kebab' | 'pascal'
];

export default function (host: {
    getVueDocument(uri: string): VueDocument | undefined,
    findReferences: (uri: string, position: vscode.Position) => Promise<vscode.Location[] | undefined>,
}): EmbeddedLanguagePlugin {

    return {

        doExecuteCommand(command, args, context) {

            if (command === convertTagNameCasingCommand) {

                const [uri, mode] = args as ConvertTagNameCasingCommandArgs;

                return worker(uri, async vueDocument => {

                    const desc = vueDocument.getDescriptor();
                    if (!desc.template)
                        return;

                    context.workDoneProgress.begin('Convert Tag Name', 0, '', true);

                    const template = desc.template;
                    const document = vueDocument.getTextDocument();
                    const edits: vscode.TextEdit[] = [];
                    const components = new Set(vueDocument.getTemplateScriptData().components);
                    const resolvedTags = vueDocument.refs.sfcTemplateScript.templateCodeGens.value?.tagNames ?? {};
                    let i = 0;

                    for (const tagName in resolvedTags) {
                        const resolvedTag = resolvedTags[tagName];
                        if (resolvedTag?.offsets.length) {

                            if (context.token.isCancellationRequested)
                                return;

                            context.workDoneProgress.report(i++ / Object.keys(resolvedTags).length * 100, tagName);

                            const offset = template.startTagEnd + resolvedTag.offsets[0];
                            const refs = await host.findReferences(uri, vueDocument.getTextDocument().positionAt(offset)) ?? [];

                            for (const vueLoc of refs) {
                                if (
                                    vueLoc.uri === vueDocument.uri
                                    && document.offsetAt(vueLoc.range.start) >= template.startTagEnd
                                    && document.offsetAt(vueLoc.range.end) <= template.startTagEnd + template.content.length
                                ) {
                                    const referenceText = document.getText(vueLoc.range);
                                    for (const component of components) {
                                        if (component === referenceText || hyphenate(component) === referenceText) {
                                            if (mode === 'kebab' && referenceText !== hyphenate(component)) {
                                                edits.push(vscode.TextEdit.replace(vueLoc.range, hyphenate(component)));
                                            }
                                            if (mode === 'pascal' && referenceText !== component) {
                                                edits.push(vscode.TextEdit.replace(vueLoc.range, component));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    context.applyEdit({ changes: { [document.uri]: edits } });
                    context.workDoneProgress.done();
                });
            }
        },
    };

    function worker<T>(uri: string, callback: (vueDocument: VueDocument) => T) {

        const vueDocument = host.getVueDocument(uri);
        if (!vueDocument)
            return;

        return callback(vueDocument);
    }
}