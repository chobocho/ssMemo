// The third-party software inside the built file, and the notices its licenses ask to be passed
// on with it. The build strips license comments from the bundle and index.html is all that gets
// distributed, so the notices are shown in the help instead. A build test compares this list
// with what the bundle really contains and with the license file of every package.

export interface ThirdPartyPackage {
  name: string;
  /** The copyright line of the package's license file, word for word. */
  copyright: string;
}

/** CodeMirror 6, the editor, and the packages it is built on. All of them are under the MIT license. */
export const THIRD_PARTY_PACKAGES: readonly ThirdPartyPackage[] = [
  { name: '@codemirror/commands', copyright: 'Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@codemirror/language', copyright: 'Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@codemirror/search', copyright: 'Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@codemirror/state', copyright: 'Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@codemirror/streamparser', copyright: 'Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@codemirror/view', copyright: 'Copyright (C) 2018-2021 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@lezer/common', copyright: 'Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@lezer/highlight', copyright: 'Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: '@marijn/find-cluster-break', copyright: 'Copyright (C) 2024 by Marijn Haverbeke <marijn@haverbeke.berlin>' },
  { name: 'crelt', copyright: 'Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin>' },
  { name: 'style-mod', copyright: 'Copyright (C) 2018 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
  { name: 'w3c-keyname', copyright: 'Copyright (C) 2016 by Marijn Haverbeke <marijn@haverbeke.berlin> and others' },
];

const LICENSE_NAME = 'MIT License';

// The same text in every one of the license files, apart from the copyright line.
const MIT_PERMISSION_NOTICE = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;

/** The notices as text: each package with its copyright line, then the license they share. */
export function formatThirdPartyNotices(): string {
  const packages = THIRD_PARTY_PACKAGES.map((entry) => `${entry.name}\n${entry.copyright}`).join('\n\n');
  return `${packages}\n\n${LICENSE_NAME}\n\n${MIT_PERMISSION_NOTICE}\n`;
}
