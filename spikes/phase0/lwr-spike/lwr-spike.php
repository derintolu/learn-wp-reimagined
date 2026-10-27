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
 * Creates a course with a certificate template, one lesson and a user, marks the
 * course complete so Certificates issues the certificate, then renders that
 * user's PDF with WooThemes_Sensei_PDF_Certificate in this request (no login as
 * the user). On failure the response lists certificate-related classes.
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

	// Certificates only issues for a course that has a certificate template, and
	// only when the course status becomes "complete" (sensei_course_status_updated).
	$template = lwr_spike_certificate_template();
	if ( $template ) {
		update_post_meta( $course, '_course_certificate_template', $template );
	}

	Sensei_Utils::sensei_start_lesson( $lesson, $user, true );
	Sensei_Utils::user_start_course( $user, $course );
	if ( method_exists( 'Sensei_Utils', 'update_course_status' ) ) {
		Sensei_Utils::update_course_status( $user, $course, 'complete' );
	}

	$cert_id = lwr_spike_find_certificate( $user, $course );
	$via     = $cert_id ? 'course_completed_hook' : null;
	if ( ! $cert_id && isset( $GLOBALS['woothemes_sensei_certificates'] ) && method_exists( $GLOBALS['woothemes_sensei_certificates'], 'generate_certificate_number' ) ) {
		$GLOBALS['woothemes_sensei_certificates']->generate_certificate_number( $user, $course );
		$cert_id = lwr_spike_find_certificate( $user, $course );
		$via     = $cert_id ? 'generate_certificate_number' : null;
	}

	$pdf   = null;
	$error = null;
	if ( $cert_id && isset( $GLOBALS['woothemes_sensei_certificates'] ) ) {
		$file = trailingslashit( $GLOBALS['woothemes_sensei_certificates']->plugin_path ) . 'classes/class-woothemes-sensei-pdf-certificate.php';
		if ( ! class_exists( 'WooThemes_Sensei_PDF_Certificate' ) && file_exists( $file ) ) {
			require_once $file;
		}
		if ( class_exists( 'WooThemes_Sensei_PDF_Certificate' ) ) {
			$hash = (string) get_post_meta( $cert_id, 'certificate_hash', true );
			if ( '' === $hash ) {
				$hash = (string) get_post_field( 'post_name', $cert_id );
			}
			// generate_pdf() sends PDF headers and echoes the bytes; capture both and
			// undo the headers so this REST response stays JSON.
			ob_start();
			try {
				( new WooThemes_Sensei_PDF_Certificate( $hash, $cert_id ) )->generate_pdf();
			} catch ( Throwable $e ) {
				$error = get_class( $e ) . ': ' . $e->getMessage();
			}
			$out = (string) ob_get_clean();
			if ( ! headers_sent() ) {
				foreach ( array( 'Content-Type', 'Content-Disposition', 'Cache-Control', 'Pragma' ) as $h ) {
					header_remove( $h );
				}
			}
			if ( '' !== $out ) {
				$pdf = $out;
			}
		} else {
			$error = 'WooThemes_Sensei_PDF_Certificate not found';
		}
	}

	if ( null === $pdf ) {
		$classes = array_values(
			array_filter(
				get_declared_classes(),
				function ( $c ) {
					return false !== stripos( $c, 'certif' );
				}
			)
		);
		return new WP_REST_Response(
			array(
				'bytes'       => 0,
				'contentType' => 'none',
				'template'    => $template,
				'certificate' => $cert_id,
				'error'       => $error,
				'classes'     => $classes,
			),
			200
		);
	}

	return array(
		'bytes'       => strlen( $pdf ),
		'contentType' => 0 === strpos( $pdf, '%PDF' ) ? 'application/pdf' : 'unknown',
		'certificate' => $cert_id,
		'via'         => $via,
		'logged_in'   => is_user_logged_in(),
	);
}

function lwr_spike_certificate_template() {
	$find = function () {
		$ids = get_posts(
			array(
				'post_type'      => 'certificate_template',
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'fields'         => 'ids',
			)
		);
		return $ids ? (int) $ids[0] : 0;
	};
	$id = $find();
	if ( ! $id && function_exists( 'sensei_create_master_certificate_template' ) ) {
		sensei_create_master_certificate_template();
		$id = $find();
	}
	return $id;
}

function lwr_spike_find_certificate( $user, $course ) {
	$ids = get_posts(
		array(
			'post_type'      => 'certificate',
			'post_status'    => 'any',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'meta_query'     => array(
				array( 'key' => 'learner_id', 'value' => (int) $user ),
				array( 'key' => 'course_id', 'value' => (int) $course ),
			),
		)
	);
	return $ids ? (int) $ids[0] : 0;
}
