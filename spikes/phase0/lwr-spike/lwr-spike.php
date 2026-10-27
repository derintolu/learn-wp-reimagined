<?php
/**
 * Plugin Name: LWR Spike
 * Description: Phase 0 probes for Learn WordPress Reimagined. Throwaway; delete after the spike.
 * Version: 0.1.0
 * License: GPL-2.0-or-later
 */

defined( 'ABSPATH' ) || exit;

const LWR_SPIKE_NS = 'lwr-spike/v1';

/**
 * Write routes are gated by a header whose SHA-256 must equal the option
 * lwr_spike_token_sha256. Only the hash is stored; the token never touches WP-CLI.
 */
function lwr_spike_gate( WP_REST_Request $request ) {
	$expected = (string) get_option( 'lwr_spike_token_sha256', '' );
	$given    = (string) $request->get_header( 'x-lwr-spike-token' );
	if ( '' === $expected || '' === $given || ! hash_equals( strtolower( $expected ), hash( 'sha256', $given ) ) ) {
		return new WP_Error( 'lwr_spike_forbidden', 'Forbidden', array( 'status' => 403 ) );
	}
	return true;
}

function lwr_spike_plugin_version( $file ) {
	if ( ! function_exists( 'get_plugin_data' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$path = WP_PLUGIN_DIR . '/' . $file;
	if ( ! file_exists( $path ) ) {
		return null;
	}
	$data = get_plugin_data( $path, false, false );
	return '' !== $data['Version'] ? $data['Version'] : null;
}

function lwr_spike_find_plugin( $needle ) {
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	foreach ( get_plugins() as $file => $data ) {
		if ( false !== stripos( $data['Name'], $needle ) ) {
			return $data['Version'];
		}
	}
	return null;
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			LWR_SPIKE_NS,
			'/ping',
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => function () {
					$auth = isset( $_SERVER['HTTP_AUTHORIZATION'] ) ? (string) $_SERVER['HTTP_AUTHORIZATION'] : '';
					if ( '' === $auth && isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
						$auth = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
					}
					return array(
						'php'             => PHP_VERSION,
						'sodium'          => extension_loaded( 'sodium' ),
						'fastcgi_finish'  => function_exists( 'fastcgi_finish_request' ),
						'basic_auth_seen' => 0 === stripos( $auth, 'Basic ' ),
						'sensei'          => defined( 'SENSEI_LMS_VERSION' ) ? SENSEI_LMS_VERSION : lwr_spike_find_plugin( 'Sensei LMS' ),
						'certificates'    => lwr_spike_find_plugin( 'Sensei LMS Certificates' ),
					);
				},
			)
		);

		register_rest_route(
			LWR_SPIKE_NS,
			'/users',
			array(
				'methods'             => 'POST',
				'permission_callback' => 'lwr_spike_gate',
				'callback'            => function () {
					$login = 'spike_' . wp_generate_password( 10, false, false );
					$id    = wp_insert_user(
						array(
							'user_login' => $login,
							'user_pass'  => wp_generate_password( 32 ),
							'user_email' => '',
							'role'       => 'subscriber',
						)
					);
					if ( is_wp_error( $id ) ) {
						return new WP_Error( 'lwr_spike_user', $id->get_error_message(), array( 'status' => 500 ) );
					}
					return new WP_REST_Response( array( 'id' => (int) $id, 'role' => 'subscriber' ), 201 );
				},
			)
		);

		register_rest_route(
			LWR_SPIKE_NS,
			'/cert-test',
			array(
				'methods'             => 'POST',
				'permission_callback' => 'lwr_spike_gate',
				'callback'            => 'lwr_spike_cert_test',
			)
		);
	}
);

/**
 * Creates a course with one lesson and a user, completes the lesson, then tries
 * to render that user's certificate PDF in this request (no login as the user).
 * The Certificates plugin's internals are not known up front, so on failure the
 * response lists certificate-related classes to guide the next attempt.
 */
function lwr_spike_cert_test() {
	if ( ! class_exists( 'Sensei_Utils' ) ) {
		return new WP_Error( 'lwr_spike_nosensei', 'Sensei is not active', array( 'status' => 500 ) );
	}
	$course = wp_insert_post( array( 'post_type' => 'course', 'post_status' => 'publish', 'post_title' => 'Spike course' ) );
	$lesson = wp_insert_post(
		array(
			'post_type'   => 'lesson',
			'post_status' => 'publish',
			'post_title'  => 'Spike lesson',
			'meta_input'  => array( '_lesson_course' => $course ),
		)
	);
	$user = wp_insert_user(
		array(
			'user_login' => 'spike_' . wp_generate_password( 10, false, false ),
			'user_pass'  => wp_generate_password( 32 ),
			'user_email' => '',
			'role'       => 'subscriber',
		)
	);
	if ( is_wp_error( $course ) || is_wp_error( $lesson ) || is_wp_error( $user ) ) {
		return new WP_Error( 'lwr_spike_setup', 'Could not create course, lesson or user', array( 'status' => 500 ) );
	}

	Sensei_Utils::sensei_start_lesson( $lesson, $user, true );
	if ( function_exists( 'Sensei' ) && isset( Sensei()->course ) && method_exists( Sensei()->course, 'get_course_id' ) ) {
		Sensei_Utils::user_start_course( $user, $course );
	}

	$classes = array_values(
		array_filter(
			get_declared_classes(),
			function ( $c ) {
				return false !== stripos( $c, 'certif' );
			}
		)
	);

	$cert_id = null;
	$posts   = get_posts(
		array(
			'post_type'      => 'certificate',
			'post_status'    => 'any',
			'author'         => $user,
			'posts_per_page' => 1,
			'fields'         => 'ids',
		)
	);
	if ( $posts ) {
		$cert_id = (int) $posts[0];
	}

	$pdf = null;
	if ( $cert_id ) {
		// Candidate renderers, tried in turn. Names are guesses; the diagnostics below show what exists.
		foreach ( array( 'Sensei_Certificates_PDF', 'Sensei_Certificates\\Pdf', 'Sensei_Certificate_PDF' ) as $cls ) {
			if ( class_exists( $cls ) ) {
				foreach ( array( 'render', 'generate', 'output_string', 'get_pdf' ) as $m ) {
					if ( method_exists( $cls, $m ) ) {
						try {
							$obj = is_callable( array( $cls, $m ) ) && ( new ReflectionMethod( $cls, $m ) )->isStatic() ? null : new $cls();
							$out = call_user_func( array( $obj ? $obj : $cls, $m ), $cert_id );
							if ( is_string( $out ) && '' !== $out ) {
								$pdf = $out;
								break 2;
							}
						} catch ( Throwable $e ) {
							continue;
						}
					}
				}
			}
		}
	}

	if ( null === $pdf ) {
		return new WP_REST_Response(
			array(
				'bytes'       => 0,
				'contentType' => 'none',
				'certificate' => $cert_id,
				'classes'     => $classes,
			),
			200
		);
	}

	return array(
		'bytes'       => strlen( $pdf ),
		'contentType' => 0 === strpos( $pdf, '%PDF' ) ? 'application/pdf' : 'unknown',
	);
}
