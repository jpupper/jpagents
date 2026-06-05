// Final definitive test: what does \\n produce in each context?
// File has these exact chars: \n and \\n and \\\n

const test1 = '\n'; // single-quoted with one backslash-n
const test2 = '\\n'; // single-quoted with two backslash-n
const test3 = '\\\\n'; // single-quoted with four backslash-n
const test4 = `\n`; // template literal with one backslash-n
const test5 = `\\n`; // template literal with two backslash-n
const test6 = `\\\\n`; // template literal with four backslash-n

console.log('test1 (\\n in sq):', JSON.stringify(test1), 'len:', test1.length, 'codes:', [...test1].map(c=>c.charCodeAt(0)));
console.log('test2 (\\\\n in sq):', JSON.stringify(test2), 'len:', test2.length, 'codes:', [...test2].map(c=>c.charCodeAt(0)));  
console.log('test3 (\\\\\\\\n in sq):', JSON.stringify(test3), 'len:', test3.length, 'codes:', [...test3].map(c=>c.charCodeAt(0)));
console.log('test4 (\\n in tl):', JSON.stringify(test4), 'len:', test4.length, 'codes:', [...test4].map(c=>c.charCodeAt(0)));
console.log('test5 (\\\\n in tl):', JSON.stringify(test5), 'len:', test5.length, 'codes:', [...test5].map(c=>c.charCodeAt(0)));
console.log('test6 (\\\\\\\\n in tl):', JSON.stringify(test6), 'len:', test6.length, 'codes:', [...test6].map(c=>c.charCodeAt(0)));

// Now test: does Telegram's Markdown treat \\n as newline?
// We can't test that directly, but let's see what grammy sends
// In HTTP JSON: \\n becomes \\\\n in JSON... or does it?
const body = JSON.stringify({ text: test6 });
console.log('\nJSON body for test6:', body.slice(0, 50));
