import { describe, expect, it } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { runChecks } from '../../src/shared/checks';
import type { Check } from '../../src/shared/types';
import { SOLUTIONS } from './solutions';

/** The real Vibe coder path: starters fail their checks, intended answers pass, plausible mistakes fail. Checks are textual; no PHP runs. */
const c = buildContent('content');
const L = c.lessons;
const MAIN = 'my-first-plugin/my-first-plugin.php';
const passes = (checks: Check[], files: Record<string, string>) => runChecks(checks, files).passed;
const php = (text: string) => ({ [MAIN]: text });

const l1 = L['vc-actions-and-filters'];
const l2 = L['vc-enqueueing'];
const l3 = L['vc-escaping-and-sanitizing'];
const l4 = L['vc-template-hierarchy'];
const l5 = L['vc-theme-json-from-code'];
const l6 = L['vc-ship-it'];

describe('vibe coder path content', () => {
  it('is live on the plugin preview: lesson 1 a bug and a free-text checkpoint, 2 code, 3 a bug and code', () => {
    const p = c.paths['vibe-coder'];
    expect(p.status).toBe('live');
    expect(p.preview).toEqual({ kind: 'plugin', slug: 'my-first-plugin' });
    expect(p.lessons.slice(0, 3)).toEqual(['vc-actions-and-filters', 'vc-enqueueing', 'vc-escaping-and-sanitizing']);
    expect(Object.keys(p.previewFiles ?? {})).toEqual([MAIN]);
    expect(p.previewFiles![MAIN]).toMatch(/^\s*\*\s*Plugin Name:\s*My First Plugin$/m);
    expect(l1.checkpoint?.kind).toBe('free-text');
    expect(l1.bug?.file).toBe(MAIN);
    expect(l2.checkpoint?.kind).toBe('code');
    expect(l2.checkpoint?.file).toBe(MAIN);
    expect(l3.bug?.file).toBe(MAIN);
    expect(l3.checkpoint?.kind).toBe('code');
    for (const l of [l1, l2]) expect(l.landing).toBe('/hello-world/');
    // Not ?name=: WordPress reads that public query var itself and serves a different page.
    expect(l3.landing).toBe('/hello-world/?reader=%3Cmark%3ESam%3C%2Fmark%3E');
  });

  it('lessons 4 to 6: 4 a free-text checkpoint on a category archive, 5 code, 6 no checkpoint', () => {
    const p = c.paths['vibe-coder'];
    expect(p.lessons).toEqual([
      'vc-actions-and-filters', 'vc-enqueueing', 'vc-escaping-and-sanitizing',
      'vc-template-hierarchy', 'vc-theme-json-from-code', 'vc-ship-it',
    ]);
    expect(l4.checkpoint?.kind).toBe('free-text');
    expect(l4.landing).toBe('/category/uncategorized/');
    expect(l4.bug).toBeUndefined();
    const fb = l4.checkpoint!.fallback.map((f) => f.outcome);
    expect(fb).toContain('advance');
    expect(fb).toContain('review');
    expect(l5.checkpoint?.kind).toBe('code');
    expect(l5.checkpoint?.file).toBe(MAIN);
    expect(l5.landing).toBe('/hello-world/');
    expect(l6.checkpoint).toBeUndefined();
    expect(l6.bug).toBeUndefined();
    for (const l of [l1, l2, l3, l4, l5, l6]) expect(l.beats.length).toBeGreaterThanOrEqual(3);
  });

  it('branches flow 1 to 6: advance and skip go forward, review goes back or stays put', () => {
    const to = (l: typeof l1, o: string) => l.checkpoint!.branches.find((b) => b.outcome === o)!.to;
    expect([to(l1, 'advance'), to(l1, 'review'), to(l1, 'skip')]).toEqual(['vc-enqueueing', 'vc-actions-and-filters', 'vc-escaping-and-sanitizing']);
    expect([to(l2, 'advance'), to(l2, 'review'), to(l2, 'skip')]).toEqual(['vc-escaping-and-sanitizing', 'vc-enqueueing', 'vc-escaping-and-sanitizing']);
    expect([to(l3, 'advance'), to(l3, 'review'), to(l3, 'skip')]).toEqual(['vc-template-hierarchy', 'vc-escaping-and-sanitizing', 'vc-template-hierarchy']);
    expect([to(l4, 'advance'), to(l4, 'review'), to(l4, 'skip')]).toEqual(['vc-theme-json-from-code', 'vc-template-hierarchy', 'vc-theme-json-from-code']);
    expect([to(l5, 'advance'), to(l5, 'review'), to(l5, 'skip')]).toEqual(['vc-ship-it', 'vc-theme-json-from-code', 'vc-ship-it']);
    for (const l of [l1, l2, l3, l4, l5]) for (const b of l.checkpoint!.branches) expect(b.message).not.toMatch(/more lessons are on the way/i);
  });

  it('every file lives under my-first-plugin/', () => {
    const p = c.paths['vibe-coder'];
    const files = [
      ...Object.keys(p.previewFiles ?? {}),
      ...Object.keys(p.finalFiles ?? {}),
      ...[l1, l2, l3, l4, l5, l6].flatMap((l) => [...Object.keys(l.starterFiles ?? {}), l.checkpoint?.file, l.bug?.file].filter(Boolean)),
    ];
    for (const f of files) expect(f).toMatch(/^my-first-plugin\//);
  });

  describe('L1 bug: a the_content filter that echoes instead of returning', () => {
    const b = l1.bug!;
    const fixed = SOLUTIONS['bug-filter-echo'][MAIN];

    it('fails the planted bug and passes the fix', () => {
      expect(passes(b.fixChecks, php(b.code))).toBe(false);
      expect(passes(b.fixChecks, php(fixed))).toBe(true);
    });

    it('accepts other ways of returning the content with the note', () => {
      expect(passes(b.fixChecks, php(fixed.replace('return $content . $note;', 'return $content.$note;')))).toBe(true);
      expect(passes(b.fixChecks, php(fixed.replace('return $content . $note;', '$content .= $note;\n\n\treturn $content;')))).toBe(true);
      expect(passes(b.fixChecks, php(fixed.replace('return $content . $note;', 'return ( $content . $note );')))).toBe(true);
      expect(passes(b.fixChecks, php(fixed.replace("add_filter( 'the_content', 'my_first_plugin_add_note' );", 'add_filter("the_content", "my_first_plugin_add_note", 10);')))).toBe(true);
    });

    it('accepts the bad line left behind as a comment', () => {
      const commented = b.code.replace('\techo $content . $note;', '\t// echo $content . $note;\n\treturn $content . $note;');
      expect(commented).not.toBe(b.code);
      expect(passes(b.fixChecks, php(commented))).toBe(true);
    });

    it('fails a return added after the echo, and print in place of echo', () => {
      expect(passes(b.fixChecks, php(b.code.replace('echo $content . $note;', 'echo $content . $note;\n\treturn $content;')))).toBe(false);
      expect(passes(b.fixChecks, php(b.code.replace('echo $content . $note;', 'print $content . $note;')))).toBe(false);
    });

    it('fails returning only the note, or only the content', () => {
      expect(passes(b.fixChecks, php(b.code.replace('echo $content . $note;', 'return $note;')))).toBe(false);
      expect(passes(b.fixChecks, php(b.code.replace('echo $content . $note;', 'return $content;')))).toBe(false);
    });

    it('fails when the hook or the note is removed', () => {
      expect(passes(b.fixChecks, php(fixed.replace("add_filter( 'the_content', 'my_first_plugin_add_note' );", '')))).toBe(false);
      expect(passes(b.fixChecks, php(fixed.replace("add_filter( 'the_content'", "add_filter( 'the_title'")))).toBe(false);
      expect(passes(b.fixChecks, php(fixed.replace(' class="my-first-plugin-note"', '')))).toBe(false);
    });
  });

  describe('L2 checkpoint: enqueue style.css on wp_enqueue_scripts', () => {
    const k = l2.checkpoint!.checks!;
    const start = l2.starterFiles![MAIN];
    const done = SOLUTIONS['cp-enqueue-style-code'][MAIN];
    const enqueue = "wp_enqueue_style( 'my-first-plugin', plugins_url( 'style.css', __FILE__ ), array(), '1.0.0' );";

    it('fails the starter and passes the intended answer', () => {
      expect(passes(k, php(start))).toBe(false);
      expect(passes(k, php(done))).toBe(true);
    });

    it('accepts the shortest call, a leading slash, double quotes, and add_action before the function', () => {
      expect(passes(k, php(done.replace(enqueue, "wp_enqueue_style( 'my-first-plugin', plugins_url( 'style.css', __FILE__ ) );")))).toBe(true);
      expect(passes(k, php(done.replace(enqueue, 'wp_enqueue_style("mfp-note", plugins_url("/style.css", __FILE__));')))).toBe(true);
      const hookFirst = `${start}
add_action( 'wp_enqueue_scripts', 'my_first_plugin_styles' );
function my_first_plugin_styles() {
	${enqueue}
}
`;
      expect(passes(k, php(hookFirst))).toBe(true);
    });

    it('accepts plugin_dir_url( __FILE__ ) . \'style.css\' as the URL', () => {
      expect(passes(k, php(done.replace("plugins_url( 'style.css', __FILE__ )", "plugin_dir_url( __FILE__ ) . 'style.css'")))).toBe(true);
    });

    it('accepts an anonymous function or an arrow function as the callback', () => {
      expect(passes(k, php(`${start}\nadd_action( 'wp_enqueue_scripts', function () {\n\t${enqueue}\n} );\n`))).toBe(true);
      expect(passes(k, php(`${start}\nadd_action( 'wp_enqueue_scripts', fn() => wp_enqueue_style( 'my-first-plugin', plugins_url( 'style.css', __FILE__ ) ) );\n`))).toBe(true);
    });

    it('fails hooking to init, or calling the enqueue loose in the file', () => {
      expect(passes(k, php(done.replace("add_action( 'wp_enqueue_scripts'", "add_action( 'init'")))).toBe(false);
      expect(passes(k, php(`${start}\n${enqueue}\n`))).toBe(false);
    });

    it('fails when add_action names a different function from the one that enqueues', () => {
      expect(passes(k, php(done.replace("'wp_enqueue_scripts', 'my_first_plugin_enqueue_styles'", "'wp_enqueue_scripts', 'my_first_plugin_styles'")))).toBe(false);
    });

    it('fails a hand-typed URL, a missing __FILE__, wp_enqueue_script for a stylesheet, and an echoed link tag', () => {
      expect(passes(k, php(done.replace("plugins_url( 'style.css', __FILE__ )", "'/wp-content/plugins/my-first-plugin/style.css'")))).toBe(false);
      expect(passes(k, php(done.replace("plugins_url( 'style.css', __FILE__ )", "plugins_url( 'style.css' )")))).toBe(false);
      expect(passes(k, php(done.replace('wp_enqueue_style(', 'wp_enqueue_script(')))).toBe(false);
      const echoed = `${start}
function my_first_plugin_styles() {
	echo '<link rel="stylesheet" href="' . plugins_url( 'style.css', __FILE__ ) . '">';
}
add_action( 'wp_head', 'my_first_plugin_styles' );
`;
      expect(passes(k, php(echoed))).toBe(false);
    });

    it('fails when the the_content filter from lesson 1 is removed', () => {
      expect(passes(k, php(done.replace("add_filter( 'the_content', 'my_first_plugin_add_note' );", '')))).toBe(false);
    });
  });

  describe('L3 bug: a query-string value output without escaping', () => {
    const b = l3.bug!;
    const fixed = SOLUTIONS['bug-unescaped-name'][MAIN];

    it('fails the planted bug, passes the fix and the checkpoint answer', () => {
      expect(passes(b.fixChecks, php(b.code))).toBe(false);
      expect(passes(b.fixChecks, php(fixed))).toBe(true);
      expect(passes(b.fixChecks, php(SOLUTIONS['cp-sanitize-name-code'][MAIN]))).toBe(true);
    });

    it('accepts esc_html without spaces', () => {
      expect(passes(b.fixChecks, php(fixed.replace('esc_html( $reader )', 'esc_html($reader)')))).toBe(true);
    });

    it('fails escaping early on input but outputting the variable raw', () => {
      const early = b.code.replace("$reader = $_GET['reader'];", "$reader = esc_html( $_GET['reader'] );");
      expect(early).not.toBe(b.code);
      expect(passes(b.fixChecks, php(early))).toBe(false);
    });

    it('fails the wrong escaper, or strip_tags', () => {
      expect(passes(b.fixChecks, php(fixed.replace('esc_html( $reader )', 'esc_attr( $reader )')))).toBe(false);
      expect(passes(b.fixChecks, php(fixed.replace('esc_html( $reader )', 'strip_tags( $reader )')))).toBe(false);
    });

    it('fails the name interpolated raw into a double-quoted string', () => {
      const interp = fixed.replace(
        "'<p class=\"my-first-plugin-note\">Thanks for reading, ' . esc_html( $reader ) . '! This note was added by my first plugin.</p>'",
        '"<p class=\'my-first-plugin-note\'>Thanks for reading, $reader! This note was added by my first plugin.</p>"',
      );
      expect(interp).not.toBe(fixed);
      expect(passes(b.fixChecks, php(interp))).toBe(false);
    });

    it('fails a raw $reader in any other sink: sprintf, esc_html only in a comment, a stray echo', () => {
      const line = "'<p class=\"my-first-plugin-note\">Thanks for reading, ' . esc_html( $reader ) . '! This note was added by my first plugin.</p>'";
      expect(fixed).toContain(line);
      const sprintfRaw = fixed.replace(line, "sprintf( '<p class=\"my-first-plugin-note\">Thanks for reading, %s!</p>', $reader )");
      const wrongVar = fixed.replace(line, "sprintf( '<p class=\"my-first-plugin-note\">Thanks for reading, %s!</p>', $reader );\n\t\t$safe = esc_html( $reader )");
      const commentOnly = sprintfRaw.replace('\t\t$note =', '\t\t// Escaped: esc_html( $reader )\n\t\t$note =');
      const strayEcho = fixed.replace('\treturn $content . $note;', '\techo $reader;\n\treturn $content . $note;');
      for (const bad of [sprintfRaw, wrongVar, commentOnly, strayEcho]) {
        expect(bad).not.toBe(fixed);
        expect(passes(b.fixChecks, php(bad))).toBe(false);
      }
    });

    it('accepts sprintf with esc_html( $reader )', () => {
      const line = "'<p class=\"my-first-plugin-note\">Thanks for reading, ' . esc_html( $reader ) . '! This note was added by my first plugin.</p>'";
      const ok = fixed.replace(line, "sprintf( '<p class=\"my-first-plugin-note\">Thanks for reading, %s!</p>', esc_html( $reader ) )");
      expect(ok).not.toBe(fixed);
      expect(passes(b.fixChecks, php(ok))).toBe(true);
    });

    it('fails when the greeting is deleted instead of fixed', () => {
      expect(passes(b.fixChecks, php(l3.starterFiles![MAIN]))).toBe(false);
    });
  });

  describe('L3 checkpoint: sanitize the input, keep escaping the output', () => {
    const k = l3.checkpoint!.checks!;
    const start = l3.starterFiles![MAIN];
    const done = SOLUTIONS['cp-sanitize-name-code'][MAIN];

    it('fails the starter and the fixed bug, and passes the intended answer', () => {
      expect(passes(k, php(start))).toBe(false);
      expect(passes(k, php(SOLUTIONS['bug-unescaped-name'][MAIN]))).toBe(false);
      expect(passes(k, php(done))).toBe(true);
    });

    it('accepts sanitize_text_field without wp_unslash, and no spaces', () => {
      expect(passes(k, php(done.replace("sanitize_text_field( wp_unslash( $_GET['reader'] ) )", "sanitize_text_field( $_GET['reader'] )")))).toBe(true);
      expect(passes(k, php(done.replace("sanitize_text_field( wp_unslash( $_GET['reader'] ) )", 'sanitize_text_field(wp_unslash($_GET["reader"]))')))).toBe(true);
    });

    it('accepts the ternary form of the sanitized assignment', () => {
      const ternary = done.replace(
        "$reader = sanitize_text_field( wp_unslash( $_GET['reader'] ) );",
        "$reader = isset( $_GET['reader'] ) ? sanitize_text_field( wp_unslash( $_GET['reader'] ) ) : '';",
      );
      expect(ternary).not.toBe(done);
      expect(passes(k, php(ternary))).toBe(true);
    });

    it('fails a raw $reader passed to sprintf even with the input sanitized', () => {
      const line = "'<p class=\"my-first-plugin-note\">Thanks for reading, ' . esc_html( $reader ) . '! This note was added by my first plugin.</p>'";
      expect(passes(k, php(done.replace(line, "sprintf( '<p>Thanks, %s!</p>', $reader )")))).toBe(false);
    });

    it('fails sanitizing but dropping the escape on output', () => {
      expect(passes(k, php(done.replace('esc_html( $reader )', '$reader')))).toBe(false);
    });

    it('fails sanitize_text_field on the output instead of the input', () => {
      const late = done
        .replace("sanitize_text_field( wp_unslash( $_GET['reader'] ) )", "wp_unslash( $_GET['reader'] )")
        .replace('esc_html( $reader )', 'sanitize_text_field( $reader )');
      expect(late).not.toBe(done);
      expect(passes(k, php(late))).toBe(false);
    });

    it('fails another sanitizer, and dropping the isset check', () => {
      expect(passes(k, php(done.replace('sanitize_text_field(', 'sanitize_email(')))).toBe(false);
      expect(passes(k, php(done.replace("isset( $_GET['reader'] )", "$_GET['reader']")))).toBe(false);
    });
  });
  describe('L5 checkpoint: a wp_theme_json_data_theme callback that calls update_with and returns the object', () => {
    const k = l5.checkpoint!.checks!;
    const start = l5.starterFiles![MAIN];
    const done = SOLUTIONS['cp-theme-json-filter-code'][MAIN];
    const ret = 'return $theme_json->update_with( $new_data );';
    const hook = "add_filter( 'wp_theme_json_data_theme', 'my_first_plugin_theme_json' );";
    const fn = done.slice(done.indexOf('/**\n * Give the theme'));
    /** Replace, and insist the replacement happened, so a passing variant is never just the unchanged answer. */
    const edit = (from: string, to: string, text = done) => {
      expect(text).toContain(from);
      return text.replace(from, to);
    };
    const arr = `array(
		'version' => 3,
		'styles'  => array(
			'elements' => array(
				'heading' => array(
					'color' => array(
						'text' => 'var:preset|color|accent-3',
					),
				),
			),
		),
	)`;

    it('the starter is the lesson 3 answer, which fails; the intended answer passes', () => {
      expect(start).toBe(SOLUTIONS['cp-sanitize-name-code'][MAIN]);
      expect(passes(k, php(start))).toBe(false);
      expect(passes(k, php(done))).toBe(true);
      expect(fn.startsWith('/**')).toBe(true);
      expect(done).toContain(arr);
    });

    it('accepts update_with then returning the object, the array inline, and hooking before the function', () => {
      expect(passes(k, php(edit(ret, '$theme_json->update_with( $new_data );\n\n\treturn $theme_json;')))).toBe(true);
      expect(passes(k, php(edit('$new_data = ' + arr + ';\n\n\t' + ret, 'return $theme_json->update_with( ' + arr + ' );')))).toBe(true);
      const hookFirst = edit(fn, hook + '\n' + fn.replace(hook, ''));
      expect(hookFirst).not.toBe(done);
      expect(passes(k, php(hookFirst))).toBe(true);
    });

    it('accepts another variable name, short array syntax, the h1 element, the CSS var form and version 2', () => {
      expect(passes(k, php(done.replaceAll('$theme_json', '$data')))).toBe(true);
      const short = edit(fn, `function my_first_plugin_theme_json( $theme_json ) {
	return $theme_json->update_with( [
		"version" => 3,
		"styles"  => [ "elements" => [ "heading" => [ "color" => [ "text" => "var:preset|color|accent-3" ] ] ] ],
	] );
}
${hook}
`);
      expect(passes(k, php(short))).toBe(true);
      expect(passes(k, php(edit("'heading' =>", "'h1' =>")))).toBe(true);
      expect(passes(k, php(edit('var:preset|color|accent-3', 'var(--wp--preset--color--accent-3)')))).toBe(true);
      expect(passes(k, php(edit("'version' => 3", "'version' => 2")))).toBe(true);
    });

    it('accepts an anonymous function or an arrow function as the callback', () => {
      const anon = start + `
add_filter( 'wp_theme_json_data_theme', function ( $theme_json ) {
	return $theme_json->update_with( ${arr} );
} );
`;
      const arrow = start + `
add_filter( 'wp_theme_json_data_theme', fn( $theme_json ) => $theme_json->update_with( ${arr} ) );
`;
      expect(passes(k, php(anon))).toBe(true);
      expect(passes(k, php(arrow))).toBe(true);
    });

    it('fails calling update_with but returning nothing, the array, or get_data()', () => {
      expect(passes(k, php(edit(ret, '$theme_json->update_with( $new_data );')))).toBe(false);
      expect(passes(k, php(edit(ret, '$theme_json->update_with( $new_data );\n\n\treturn $new_data;')))).toBe(false);
      expect(passes(k, php(edit(ret, '$theme_json->update_with( $new_data );\n\n\treturn $theme_json->get_data();')))).toBe(false);
    });

    it('fails returning the array without update_with', () => {
      expect(passes(k, php(edit(ret, 'return $new_data;')))).toBe(false);
    });

    it('fails a missing version', () => {
      expect(passes(k, php(edit("\t\t'version' => 3,\n", '')))).toBe(false);
    });

    it('fails the wrong layer, add_action, or a mismatched callback name', () => {
      for (const layer of ['wp_theme_json_data_default', 'wp_theme_json_data_blocks', 'wp_theme_json_data_user']) {
        expect(passes(k, php(edit("'wp_theme_json_data_theme'", `'${layer}'`)))).toBe(false);
      }
      expect(passes(k, php(edit(hook, "add_action( 'wp_theme_json_data_theme', 'my_first_plugin_theme_json' );")))).toBe(false);
      expect(passes(k, php(edit(hook, "add_filter( 'wp_theme_json_data_theme', 'my_first_plugin_json' );")))).toBe(false);
    });

    it('fails the colour set as a palette, under settings, or as another colour', () => {
      const palette = edit(fn, `function my_first_plugin_theme_json( $theme_json ) {
	return $theme_json->update_with( array(
		'version'  => 3,
		'settings' => array(
			'color' => array(
				'palette' => array(
					array( 'name' => 'Heading', 'slug' => 'heading', 'color' => '#503AA8' ),
				),
			),
		),
	) );
}
${hook}
`);
      expect(passes(k, php(palette))).toBe(false);
      expect(passes(k, php(edit("'styles'  =>", "'settings' =>")))).toBe(false);
      expect(passes(k, php(edit('accent-3', 'accent-1')))).toBe(false);
      expect(passes(k, php(edit("'text' =>", "'background' =>")))).toBe(false);
    });

    it('fails when the the_content filter from lesson 1 is removed', () => {
      expect(passes(k, php(edit("add_filter( 'the_content', 'my_first_plugin_add_note' );", '')))).toBe(false);
    });

    it('the finished plugin is the lesson 5 answer, and it still passes every earlier check', () => {
      const p = c.paths['vibe-coder'];
      expect(p.finalFiles![MAIN]).toBe(done);
      expect(passes(l1.bug!.fixChecks, php(done))).toBe(true);
      expect(passes(l2.checkpoint!.checks!, php(done))).toBe(true);
      expect(passes([...l3.bug!.fixChecks, ...l3.checkpoint!.checks!], php(done))).toBe(true);
    });
  });
});
