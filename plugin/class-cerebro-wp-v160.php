<?php
/**
 * Cerebro SEO WP Plugin v1.6.0 — Elementor Pro Edition
 *
 * Adds page-editing and landing-creation endpoints to the Click Society plugin.
 * Must be included/instantiated from the main plugin file after v1.5.0 class.
 *
 * New endpoints:
 *   GET  /kit                                       — Elementor global colors + typography
 *   POST /elementor/duplicate/{pageId}              — Copy published page as draft
 *   PATCH /elementor/{draftId}/widgets              — Batch widget text/image/button updates
 *   POST /elementor/apply/{draftId}                 — Apply draft to original (creates WP revision)
 *   POST /elementor/revert/{pageId}/{revisionId}    — Restore pre-apply state
 *   POST /elementor/from-template                   — Clone local template as new draft
 *   POST /elementor/import                          — Import Elementor V3 containers JSON as draft
 *   GET  /forms/submissions                         — Elementor Pro form submission counts (no PII)
 *   GET  /system-info                               — v1.6.0: active_plugins list + Pro status
 *   GET  /capabilities                              — v1.6.0: all endpoints + write_require_task_id
 *
 * RULES:
 *   - NEVER write _elementor_data directly. Always use:
 *       \Elementor\Plugin::$instance->documents->get($id)->save(['elements' => $elements])
 *   - Write routes require X-Task-Id header (audit trail).
 *   - Never expose API keys in responses or logs.
 *
 * Auth:
 *   Header X-Cerebro-Key must match WP option 'clicksociety_api_key'.
 *   Write routes additionally require X-Task-Id header.
 *
 * @package CerebroSEO
 * @version 1.6.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Cerebro_WP_V160 {

    const NAMESPACE = 'clicksociety/v1';
    const VERSION   = '1.6.0';

    /**
     * Post meta: stores the WP revision ID created just before apply(), for revert().
     * Stored on the ORIGINAL page post.
     */
    const META_PRE_APPLY_REVISION = '_cerebro_pre_apply_revision';

    /**
     * Post meta: stores the original page ID on a Cerebro draft.
     * Set during duplicate() so apply() can resolve the target without extra params.
     */
    const META_DRAFT_SOURCE_PAGE = '_cerebro_draft_source_page';

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------

    public function init(): void {
        add_action( 'rest_api_init', [ $this, 'register_routes' ] );
    }

    // -------------------------------------------------------------------------
    // Route registration
    // -------------------------------------------------------------------------

    public function register_routes(): void {

        // --- Read routes ---

        register_rest_route( self::NAMESPACE, '/kit', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [ $this, 'handle_kit' ],
            'permission_callback' => [ $this, 'check_read_auth' ],
        ] );

        register_rest_route( self::NAMESPACE, '/forms/submissions', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [ $this, 'handle_forms_submissions' ],
            'permission_callback' => [ $this, 'check_read_auth' ],
        ] );

        register_rest_route( self::NAMESPACE, '/system-info', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [ $this, 'handle_system_info' ],
            'permission_callback' => [ $this, 'check_read_auth' ],
        ] );

        register_rest_route( self::NAMESPACE, '/capabilities', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [ $this, 'handle_capabilities' ],
            'permission_callback' => [ $this, 'check_read_auth' ],
        ] );

        // --- Write routes (all require X-Task-Id) ---

        register_rest_route( self::NAMESPACE, '/elementor/duplicate/(?P<page_id>\d+)', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [ $this, 'handle_elementor_duplicate' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
            'args'                => [
                'page_id' => [ 'type' => 'integer', 'required' => true, 'minimum' => 1 ],
            ],
        ] );

        register_rest_route( self::NAMESPACE, '/elementor/(?P<draft_id>\d+)/widgets', [
            'methods'             => 'PATCH',
            'callback'            => [ $this, 'handle_elementor_widgets' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
            'args'                => [
                'draft_id' => [ 'type' => 'integer', 'required' => true, 'minimum' => 1 ],
            ],
        ] );

        register_rest_route( self::NAMESPACE, '/elementor/apply/(?P<draft_id>\d+)', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [ $this, 'handle_elementor_apply' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
            'args'                => [
                'draft_id' => [ 'type' => 'integer', 'required' => true, 'minimum' => 1 ],
            ],
        ] );

        register_rest_route( self::NAMESPACE, '/elementor/revert/(?P<page_id>\d+)/(?P<revision_id>\d+)', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [ $this, 'handle_elementor_revert' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
            'args'                => [
                'page_id'     => [ 'type' => 'integer', 'required' => true, 'minimum' => 1 ],
                'revision_id' => [ 'type' => 'integer', 'required' => true, 'minimum' => 1 ],
            ],
        ] );

        register_rest_route( self::NAMESPACE, '/elementor/from-template', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [ $this, 'handle_elementor_from_template' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
        ] );

        register_rest_route( self::NAMESPACE, '/elementor/import', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [ $this, 'handle_elementor_import' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
        ] );

        // Enhanced /update/{id} (v1.6.0: featured_image_id, Elementor-aware routing)
        register_rest_route( self::NAMESPACE, '/update/(?P<id>\d+)', [
            'methods'             => 'PUT',
            'callback'            => [ $this, 'handle_update' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
            'args'                => [
                'id' => [ 'type' => 'integer', 'required' => true, 'minimum' => 1 ],
            ],
        ] );

        // Enhanced /media (v1.6.0: alt required, SEO filename, returns dimensions)
        register_rest_route( self::NAMESPACE, '/media', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [ $this, 'handle_media' ],
            'permission_callback' => [ $this, 'check_write_auth' ],
        ] );
    }

    // -------------------------------------------------------------------------
    // Auth
    // -------------------------------------------------------------------------

    public function check_read_auth( WP_REST_Request $request ): bool {
        return $this->verify_api_key( $request );
    }

    public function check_write_auth( WP_REST_Request $request ): bool {
        if ( ! $this->verify_api_key( $request ) ) {
            return false;
        }
        // All write routes require X-Task-Id for audit trail
        return ! empty( $request->get_header( 'x-task-id' ) );
    }

    private function verify_api_key( WP_REST_Request $request ): bool {
        $stored = get_option( 'clicksociety_api_key', '' );
        if ( empty( $stored ) ) {
            return false;
        }
        $provided = $request->get_header( 'x-cerebro-key' );
        return ! empty( $provided ) && hash_equals( $stored, $provided );
    }

    /**
     * Ensure a WordPress user with admin capabilities is set before calling
     * Elementor's Document API, which checks current_user_can() internally.
     */
    private function set_elementor_user(): void {
        if ( get_current_user_id() ) {
            return;
        }
        $admins = get_users( [ 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ] );
        if ( ! empty( $admins ) ) {
            wp_set_current_user( (int) $admins[0] );
        }
    }

    // -------------------------------------------------------------------------
    // GET /kit
    // -------------------------------------------------------------------------

    public function handle_kit( WP_REST_Request $request ): WP_REST_Response {
        if ( ! $this->elementor_active() ) {
            return $this->error( 'elementor_not_active', 'Elementor no esta activo', 503 );
        }

        $kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();
        if ( ! $kit ) {
            return $this->error( 'no_kit', 'No hay un Elementor kit activo', 404 );
        }

        $settings = $kit->get_settings_for_display();

        $system_colors = array_map( function( $item ) {
            return [
                '_id'   => $item['_id'] ?? '',
                'title' => $item['title'] ?? '',
                'color' => $item['color'] ?? '',
            ];
        }, (array) ( $settings['system_colors'] ?? [] ) );

        $custom_colors = array_map( function( $item ) {
            return [
                '_id'   => $item['_id'] ?? '',
                'title' => $item['title'] ?? '',
                'color' => $item['color'] ?? '',
            ];
        }, (array) ( $settings['custom_colors'] ?? [] ) );

        $system_typography = array_map( function( $item ) {
            return [
                '_id'          => $item['_id'] ?? '',
                'title'        => $item['title'] ?? '',
                'font_family'  => $item['typography_font_family'] ?? '',
                'font_weight'  => $item['typography_font_weight'] ?? '',
                'font_size'    => $item['typography_font_size']['size'] ?? '',
                'font_size_unit' => $item['typography_font_size']['unit'] ?? 'px',
            ];
        }, (array) ( $settings['system_typography'] ?? [] ) );

        $custom_typography = array_map( function( $item ) {
            return [
                '_id'         => $item['_id'] ?? '',
                'title'       => $item['title'] ?? '',
                'font_family' => $item['typography_font_family'] ?? '',
                'font_weight' => $item['typography_font_weight'] ?? '',
            ];
        }, (array) ( $settings['custom_typography'] ?? [] ) );

        return $this->ok( [
            'kit_id'            => $kit->get_main_id(),
            'kit_title'         => $kit->get_post()->post_title,
            'system_colors'     => $system_colors,
            'custom_colors'     => $custom_colors,
            'system_typography' => $system_typography,
            'custom_typography' => $custom_typography,
        ] );
    }

    // -------------------------------------------------------------------------
    // POST /elementor/duplicate/{page_id}
    // -------------------------------------------------------------------------

    public function handle_elementor_duplicate( WP_REST_Request $request ): WP_REST_Response {
        if ( ! $this->elementor_active() ) {
            return $this->error( 'elementor_not_active', 'Elementor no esta activo', 503 );
        }

        $page_id    = (int) $request->get_param( 'page_id' );
        $source_post = get_post( $page_id );
        if ( ! $source_post ) {
            return $this->error( 'not_found', "Pagina {$page_id} no encontrada", 404 );
        }

        $this->set_elementor_user();

        $source_doc = \Elementor\Plugin::$instance->documents->get( $page_id );
        if ( ! $source_doc ) {
            return $this->error( 'no_elementor_doc', "La pagina {$page_id} no tiene documento Elementor", 422 );
        }

        $source_elements = $source_doc->get_elements_data();

        // Create draft post
        $draft_title = $source_post->post_title . ' — Borrador Cerebro';
        $draft_id    = wp_insert_post( [
            'post_title'  => $draft_title,
            'post_status' => 'draft',
            'post_type'   => $source_post->post_type,
            'post_author' => get_current_user_id(),
        ] );

        if ( is_wp_error( $draft_id ) ) {
            return $this->error( 'insert_failed', $draft_id->get_error_message(), 500 );
        }

        // Save elements via Document API — never writes _elementor_data directly
        $draft_doc = \Elementor\Plugin::$instance->documents->get( $draft_id );
        if ( $draft_doc && is_array( $source_elements ) ) {
            $draft_doc->save( [ 'elements' => $source_elements ] );
        }

        // Store source page for apply() lookup
        update_post_meta( $draft_id, self::META_DRAFT_SOURCE_PAGE, $page_id );

        return $this->ok( [
            'draft_id'    => $draft_id,
            'draft_title' => $draft_title,
            'source_id'   => $page_id,
            'edit_url'    => admin_url( "post.php?post={$draft_id}&action=elementor" ),
            'widgets'     => $this->simplify_elements( $source_elements ?? [] ),
        ], 201 );
    }

    // -------------------------------------------------------------------------
    // PATCH /elementor/{draft_id}/widgets
    // -------------------------------------------------------------------------

    public function handle_elementor_widgets( WP_REST_Request $request ): WP_REST_Response {
        if ( ! $this->elementor_active() ) {
            return $this->error( 'elementor_not_active', 'Elementor no esta activo', 503 );
        }

        $draft_id = (int) $request->get_param( 'draft_id' );
        $body     = $request->get_json_params();
        $updates  = $body['widgets'] ?? [];

        if ( ! is_array( $updates ) || empty( $updates ) ) {
            return $this->error( 'invalid_body', 'Se requiere widgets: array de actualizaciones', 400 );
        }

        if ( ! get_post( $draft_id ) ) {
            return $this->error( 'not_found', "Borrador {$draft_id} no encontrado", 404 );
        }

        $this->set_elementor_user();

        $doc = \Elementor\Plugin::$instance->documents->get( $draft_id );
        if ( ! $doc ) {
            return $this->error( 'no_elementor_doc', "Borrador {$draft_id} no tiene documento Elementor", 422 );
        }

        $elements  = $doc->get_elements_data() ?? [];
        $applied   = 0;
        $not_found = [];

        foreach ( $updates as $update ) {
            $widget_id = $update['id'] ?? null;
            if ( ! $widget_id ) {
                continue;
            }
            if ( $this->apply_widget_update( $elements, $update ) ) {
                $applied++;
            } else {
                $not_found[] = $widget_id;
            }
        }

        if ( $applied > 0 ) {
            // Persist changes via Document API — correct path, not direct meta write
            $doc->save( [ 'elements' => $elements ] );
        }

        return $this->ok( [
            'draft_id'  => $draft_id,
            'applied'   => $applied,
            'not_found' => $not_found,
            'widgets'   => $this->simplify_elements( $elements ),
        ] );
    }

    // -------------------------------------------------------------------------
    // POST /elementor/apply/{draft_id}
    // -------------------------------------------------------------------------

    public function handle_elementor_apply( WP_REST_Request $request ): WP_REST_Response {
        if ( ! $this->elementor_active() ) {
            return $this->error( 'elementor_not_active', 'Elementor no esta activo', 503 );
        }

        $draft_id = (int) $request->get_param( 'draft_id' );
        $body     = $request->get_json_params();

        // Resolve original page: from body param or stored meta
        $original_id = ! empty( $body['original_id'] )
            ? (int) $body['original_id']
            : (int) get_post_meta( $draft_id, self::META_DRAFT_SOURCE_PAGE, true );

        if ( ! $original_id ) {
            return $this->error(
                'missing_original',
                'No se pudo determinar la pagina original. Incluye original_id en el body.',
                400
            );
        }

        $draft_post    = get_post( $draft_id );
        $original_post = get_post( $original_id );

        if ( ! $draft_post ) {
            return $this->error( 'draft_not_found', "Borrador {$draft_id} no encontrado", 404 );
        }
        if ( ! $original_post ) {
            return $this->error( 'original_not_found', "Pagina original {$original_id} no encontrada", 404 );
        }

        $this->set_elementor_user();

        $draft_doc = \Elementor\Plugin::$instance->documents->get( $draft_id );
        if ( ! $draft_doc ) {
            return $this->error( 'no_draft_doc', "Borrador {$draft_id} no tiene documento Elementor", 422 );
        }

        $original_doc = \Elementor\Plugin::$instance->documents->get( $original_id );
        if ( ! $original_doc ) {
            return $this->error( 'no_original_doc', "Pagina {$original_id} no tiene documento Elementor", 422 );
        }

        // 1. Create WP revision of original BEFORE overwriting (used by revert)
        $revision_id = wp_save_post_revision( $original_id );
        $revision_id = is_wp_error( $revision_id ) ? 0 : (int) $revision_id;

        if ( $revision_id ) {
            update_post_meta( $original_id, self::META_PRE_APPLY_REVISION, $revision_id );
        }

        // 2. Get draft elements and overwrite original via Document API
        $draft_elements = $draft_doc->get_elements_data();
        $original_doc->save( [ 'elements' => $draft_elements ] );

        // 3. Re-publish original if it was live
        if ( $original_post->post_status === 'publish' ) {
            wp_update_post( [ 'ID' => $original_id, 'post_status' => 'publish' ] );
        }

        // 4. Delete the draft — it has been consumed
        wp_delete_post( $draft_id, true );

        return $this->ok( [
            'original_id' => $original_id,
            'link'        => get_permalink( $original_id ),
            'revision_id' => $revision_id ?: null,
            'applied_at'  => gmdate( 'c' ),
        ] );
    }

    // -------------------------------------------------------------------------
    // POST /elementor/revert/{page_id}/{revision_id}
    // -------------------------------------------------------------------------

    public function handle_elementor_revert( WP_REST_Request $request ): WP_REST_Response {
        if ( ! $this->elementor_active() ) {
            return $this->error( 'elementor_not_active', 'Elementor no esta activo', 503 );
        }

        $page_id     = (int) $request->get_param( 'page_id' );
        $revision_id = (int) $request->get_param( 'revision_id' );

        if ( ! get_post( $page_id ) ) {
            return $this->error( 'page_not_found', "Pagina {$page_id} no encontrada", 404 );
        }

        $revision_post = wp_get_post_revision( $revision_id );
        if ( ! $revision_post ) {
            return $this->error( 'revision_not_found', "Revision {$revision_id} no encontrada", 404 );
        }
        if ( (int) $revision_post->post_parent !== $page_id ) {
            return $this->error( 'revision_mismatch', "La revision {$revision_id} no pertenece a la pagina {$page_id}", 400 );
        }

        $this->set_elementor_user();

        // Restore WP post fields (title, excerpt, post_content) via WP core
        wp_restore_post_revision( $revision_id );

        // Restore Elementor elements from the revision's stored data.
        // Reading _elementor_data from a revision post is a read operation —
        // writing back to the live page goes through Document API (never direct meta write).
        $revision_el_data = get_post_meta( $revision_id, '_elementor_data', true );
        if ( ! empty( $revision_el_data ) ) {
            $elements = json_decode( $revision_el_data, true );
            if ( is_array( $elements ) ) {
                $page_doc = \Elementor\Plugin::$instance->documents->get( $page_id );
                if ( $page_doc ) {
                    // This is the ONLY correct write path — Document API handles cache + hooks
                    $page_doc->save( [ 'elements' => $elements ] );
                }
            }
        }

        delete_post_meta( $page_id, self::META_PRE_APPLY_REVISION );

        return $this->ok( [
            'page_id'     => $page_id,
            'revision_id' => $revision_id,
            'reverted_at' => gmdate( 'c' ),
            'link'        => get_permalink( $page_id ),
        ] );
    }

    // -------------------------------------------------------------------------
    // POST /elementor/from-template
    // -------------------------------------------------------------------------

    public function handle_elementor_from_template( WP_REST_Request $request ): WP_REST_Response {
        if ( ! $this->elementor_active() ) {
            return $this->error( 'elementor_not_active', 'Elementor no esta activo', 503 );
        }

        $body        = $request->get_json_params();
        $template_id = isset( $body['template_id'] ) ? (int) $body['template_id'] : 0;
        $title       = ! empty( $body['title'] ) ? sanitize_text_field( $body['title'] ) : '';
        $post_type   = ! empty( $body['post_type'] ) ? sanitize_key( $body['post_type'] ) : 'page';

        if ( ! $template_id ) {
            return $this->error( 'missing_template_id', 'Se requiere template_id', 400 );
        }
        if ( empty( $title ) ) {
            return $this->error( 'missing_title', 'Se requiere title', 400 );
        }

        $this->set_elementor_user();

        // Fetch template elements via templates_manager — the correct API
        $source = \Elementor\Plugin::$instance->templates_manager->get_source( 'local' );
        if ( ! $source ) {
            return $this->error( 'no_template_source', 'templates_manager source "local" no disponible', 503 );
        }

        $template_data = $source->get_data( [ 'id' => $template_id ] );
        if ( empty( $template_data['content'] ) ) {
            return $this->error( 'template_not_found', "Plantilla {$template_id} no encontrada o vacia", 404 );
        }

        $elements = $template_data['content'];

        // Re-generate element IDs to avoid conflicts if this template is used multiple times
        $elements = $this->regenerate_element_ids( $elements );

        // Create draft post
        $draft_id = wp_insert_post( [
            'post_title'  => $title,
            'post_status' => 'draft',
            'post_type'   => $post_type,
            'post_author' => get_current_user_id(),
        ] );

        if ( is_wp_error( $draft_id ) ) {
            return $this->error( 'insert_failed', $draft_id->get_error_message(), 500 );
        }

        // Save elements via Document API
        $draft_doc = \Elementor\Plugin::$instance->documents->get( $draft_id );
        if ( $draft_doc ) {
            $draft_doc->save( [ 'elements' => $elements ] );
        }

        return $this->ok( [
            'draft_id'    => $draft_id,
            'draft_title' => $title,
            'template_id' => $template_id,
            'post_type'   => $post_type,
            'edit_url'    => admin_url( "post.php?post={$draft_id}&action=elementor" ),
            'widgets'     => $this->simplify_elements( $elements ),
        ], 201 );
    }

    // -------------------------------------------------------------------------
    // POST /elementor/import
    // -------------------------------------------------------------------------

    public function handle_elementor_import( WP_REST_Request $request ): WP_REST_Response {
        if ( ! $this->elementor_active() ) {
            return $this->error( 'elementor_not_active', 'Elementor no esta activo', 503 );
        }

        $body      = $request->get_json_params();
        $title     = ! empty( $body['title'] ) ? sanitize_text_field( $body['title'] ) : '';
        $elements  = $body['elements'] ?? null;
        $post_type = ! empty( $body['post_type'] ) ? sanitize_key( $body['post_type'] ) : 'page';

        if ( empty( $title ) ) {
            return $this->error( 'missing_title', 'Se requiere title', 400 );
        }
        if ( ! is_array( $elements ) || empty( $elements ) ) {
            return $this->error( 'missing_elements', 'Se requiere elements: array de containers Elementor V3', 400 );
        }

        $this->set_elementor_user();

        // Re-generate IDs to prevent widget ID collisions
        $fresh_elements = $this->regenerate_element_ids( $elements );

        $draft_id = wp_insert_post( [
            'post_title'  => $title,
            'post_status' => 'draft',
            'post_type'   => $post_type,
            'post_author' => get_current_user_id(),
        ] );

        if ( is_wp_error( $draft_id ) ) {
            return $this->error( 'insert_failed', $draft_id->get_error_message(), 500 );
        }

        // Save via Document API
        $draft_doc = \Elementor\Plugin::$instance->documents->get( $draft_id );
        if ( $draft_doc ) {
            $draft_doc->save( [ 'elements' => $fresh_elements ] );
        }

        return $this->ok( [
            'draft_id'    => $draft_id,
            'draft_title' => $title,
            'post_type'   => $post_type,
            'edit_url'    => admin_url( "post.php?post={$draft_id}&action=elementor" ),
            'widgets'     => $this->simplify_elements( $fresh_elements ),
        ], 201 );
    }

    // -------------------------------------------------------------------------
    // GET /forms/submissions
    // -------------------------------------------------------------------------

    public function handle_forms_submissions( WP_REST_Request $request ): WP_REST_Response {
        if ( ! class_exists( '\ElementorPro\Plugin' ) ) {
            return $this->ok( [
                'elementor_pro' => false,
                'message'       => 'Elementor Pro no activo — submissions no disponibles',
                'submissions'   => [],
            ] );
        }

        global $wpdb;

        $submissions_table = $wpdb->prefix . 'e_submissions';
        $values_table      = $wpdb->prefix . 'e_submissions_values';

        // Check if the submissions table exists
        $table_exists = (int) $wpdb->get_var( $wpdb->prepare(
            'SELECT COUNT(1) FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s',
            DB_NAME,
            $submissions_table
        ) );

        if ( ! $table_exists ) {
            return $this->ok( [
                'elementor_pro' => true,
                'message'       => 'Tabla de submissions no encontrada. Activa "Database" en Elementor Pro > Form > Actions.',
                'submissions'   => [],
            ] );
        }

        // Submission counts per form page (last 30 days)
        $since    = gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS );
        $rows     = $wpdb->get_results( $wpdb->prepare(
            "SELECT post_id, COUNT(*) AS cnt, MAX(created_at) AS last_at
             FROM {$submissions_table}
             WHERE created_at >= %s
             GROUP BY post_id
             ORDER BY cnt DESC
             LIMIT 50",
            $since
        ), ARRAY_A );

        // Field names only — no values (PII)
        $fields_by_page = [];
        $values_exists  = (int) $wpdb->get_var( $wpdb->prepare(
            'SELECT COUNT(1) FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s',
            DB_NAME,
            $values_table
        ) );

        if ( $values_exists ) {
            $field_rows = $wpdb->get_results(
                "SELECT DISTINCT s.post_id, v.key
                 FROM {$submissions_table} s
                 JOIN {$values_table} v ON v.submission_id = s.id
                 LIMIT 500",
                ARRAY_A
            );
            foreach ( $field_rows as $fr ) {
                $pid = (int) $fr['post_id'];
                $fields_by_page[ $pid ][] = $fr['key'];
            }
        }

        $summaries = [];
        foreach ( $rows as $row ) {
            $pid      = (int) $row['post_id'];
            $post     = get_post( $pid );
            $summaries[] = [
                'form_page_id'    => $pid,
                'form_page_title' => $post ? $post->post_title : "Post #{$pid}",
                'count_30d'       => (int) $row['cnt'],
                'last_submission' => $row['last_at'],
                'field_names'     => array_values( array_unique( $fields_by_page[ $pid ] ?? [] ) ),
            ];
        }

        return $this->ok( [
            'elementor_pro' => true,
            'period'        => 'last_30_days',
            'total_forms'   => count( $summaries ),
            'submissions'   => $summaries,
        ] );
    }

    // -------------------------------------------------------------------------
    // GET /system-info  (v1.6.0 — adds active_plugins)
    // -------------------------------------------------------------------------

    public function handle_system_info( WP_REST_Request $request ): WP_REST_Response {
        global $wp_version;

        $active_plugins = [];
        foreach ( get_option( 'active_plugins', [] ) as $plugin_path ) {
            if ( ! function_exists( 'get_plugin_data' ) ) {
                require_once ABSPATH . 'wp-admin/includes/plugin.php';
            }
            $data             = get_plugin_data( WP_PLUGIN_DIR . '/' . $plugin_path, false, false );
            $active_plugins[] = [
                'slug'    => dirname( $plugin_path ),
                'name'    => $data['Name'] ?? $plugin_path,
                'version' => $data['Version'] ?? '',
            ];
        }

        return $this->ok( [
            'plugin_version'        => self::VERSION,
            'wordpress_version'     => $wp_version,
            'php_version'           => PHP_VERSION,
            'elementor_active'      => $this->elementor_active(),
            'elementor_version'     => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null,
            'elementor_pro_active'  => class_exists( '\ElementorPro\Plugin' ),
            'elementor_pro_version' => defined( 'ELEMENTOR_PRO_VERSION' ) ? ELEMENTOR_PRO_VERSION : null,
            'active_plugins'        => $active_plugins,
            'theme_name'            => wp_get_theme()->get( 'Name' ),
            'theme_version'         => wp_get_theme()->get( 'Version' ),
            'site_url'              => get_site_url(),
            'is_multisite'          => is_multisite(),
        ] );
    }

    // -------------------------------------------------------------------------
    // GET /capabilities  (v1.6.0)
    // -------------------------------------------------------------------------

    public function handle_capabilities( WP_REST_Request $request ): WP_REST_Response {
        $el     = $this->elementor_active();
        $el_pro = class_exists( '\ElementorPro\Plugin' );

        $endpoints = [
            // v1.5.0 read
            'ping', 'categories', 'system-info', 'capabilities', 'pages',
            'elementor/{id}', 'seo/{id}', 'templates',
            // v1.5.0 write
            'publish', 'media', 'update/{id}',
            // v1.6.0 read
            'kit',
            // v1.6.0 write
            'elementor/duplicate/{pageId}',
            'elementor/{draftId}/widgets',
            'elementor/apply/{draftId}',
            'elementor/revert/{pageId}/{revisionId}',
            'elementor/from-template',
            'elementor/import',
        ];

        if ( $el_pro ) {
            $endpoints[] = 'forms/submissions';
        }

        return $this->ok( [
            'version'               => self::VERSION,
            'endpoints'             => $endpoints,
            'write_require_task_id' => true,
            'elementor_active'      => $el,
            'elementor_pro_active'  => $el_pro,
            'limitations'           => [
                'elementor_required'     => 'Rutas /kit y /elementor/* requieren Elementor activo',
                'elementor_pro_required' => '/forms/submissions requiere Elementor Pro con Database Storage activado',
                'write_auth'             => 'Rutas de escritura: X-Cerebro-Key + X-Task-Id',
                'apply_irreversible'     => 'apply elimina el borrador; usa revision_id devuelto para revertir',
                'revert_window'          => 'WP conserva las ultimas 25 revisiones por defecto',
            ],
        ] );
    }

    // -------------------------------------------------------------------------
    // PUT /update/{id}  (v1.6.0: featured_image_id, Elementor-aware)
    // -------------------------------------------------------------------------

    public function handle_update( WP_REST_Request $request ): WP_REST_Response {
        $post_id = (int) $request->get_param( 'id' );
        $post    = get_post( $post_id );

        if ( ! $post ) {
            return $this->error( 'not_found', "Post {$post_id} no encontrado", 404 );
        }

        $body = $request->get_json_params();

        $this->set_elementor_user();

        // Standard WP fields
        $wp_update = [ 'ID' => $post_id ];
        if ( isset( $body['title'] ) ) {
            $wp_update['post_title'] = sanitize_text_field( $body['title'] );
        }
        if ( isset( $body['status'] ) && in_array( $body['status'], [ 'publish', 'draft', 'private' ], true ) ) {
            $wp_update['post_status'] = $body['status'];
        }
        if ( isset( $body['content'] ) && ! $this->is_elementor_post( $post_id ) ) {
            // Only set post_content for non-Elementor posts; Elementor posts use Document API
            $wp_update['post_content'] = wp_kses_post( $body['content'] );
        }

        if ( count( $wp_update ) > 1 ) {
            $result = wp_update_post( $wp_update, true );
            if ( is_wp_error( $result ) ) {
                return $this->error( 'update_failed', $result->get_error_message(), 500 );
            }
        }

        // Featured image
        if ( isset( $body['featured_image_id'] ) ) {
            $img_id = (int) $body['featured_image_id'];
            if ( $img_id > 0 ) {
                set_post_thumbnail( $post_id, $img_id );
            } else {
                delete_post_thumbnail( $post_id );
            }
        }

        // Elementor content update via Document API (content or heading_level changes)
        if ( isset( $body['content'] ) && $this->is_elementor_post( $post_id ) ) {
            $doc = \Elementor\Plugin::$instance->documents->get( $post_id );
            if ( $doc ) {
                $elements = $doc->get_elements_data() ?? [];
                // content update: replace first text-editor widget found
                $this->update_first_text_widget( $elements, wp_kses_post( $body['content'] ) );
                $doc->save( [ 'elements' => $elements ] );
            }
        }

        $updated_post = get_post( $post_id );

        return $this->ok( [
            'success' => true,
            'post_id' => $post_id,
            'status'  => $updated_post->post_status,
            'link'    => get_permalink( $post_id ),
        ] );
    }

    // -------------------------------------------------------------------------
    // POST /media  (v1.6.0: alt required, SEO filename, returns dimensions)
    // -------------------------------------------------------------------------

    public function handle_media( WP_REST_Request $request ): WP_REST_Response {
        if ( ! function_exists( 'wp_handle_sideload' ) ) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
        }

        $body = $request->get_json_params();
        $url  = ! empty( $body['url'] ) ? esc_url_raw( $body['url'] ) : '';
        $alt  = isset( $body['alt'] ) ? sanitize_text_field( $body['alt'] ) : '';

        if ( empty( $url ) ) {
            return $this->error( 'missing_url', 'Se requiere url de la imagen', 400 );
        }
        if ( empty( $alt ) ) {
            return $this->error( 'missing_alt', 'Se requiere alt (texto alternativo para SEO)', 400 );
        }

        // Download remote file
        $tmp = download_url( $url );
        if ( is_wp_error( $tmp ) ) {
            return $this->error( 'download_failed', $tmp->get_error_message(), 500 );
        }

        // SEO filename: use provided filename or derive from alt text
        $seo_filename = '';
        if ( ! empty( $body['filename'] ) ) {
            $seo_filename = sanitize_file_name( $body['filename'] );
        } else {
            $seo_filename = sanitize_title( $alt ) . '.' . pathinfo( parse_url( $url, PHP_URL_PATH ), PATHINFO_EXTENSION );
        }

        $file_array = [
            'name'     => $seo_filename,
            'tmp_name' => $tmp,
        ];

        $attachment_id = media_handle_sideload( $file_array, 0 );
        @unlink( $tmp );

        if ( is_wp_error( $attachment_id ) ) {
            return $this->error( 'upload_failed', $attachment_id->get_error_message(), 500 );
        }

        // Set alt text
        update_post_meta( $attachment_id, '_wp_attachment_image_alt', $alt );

        // Set title from alt or body
        $title = ! empty( $body['title'] ) ? sanitize_text_field( $body['title'] ) : $alt;
        wp_update_post( [ 'ID' => $attachment_id, 'post_title' => $title ] );

        // Get image dimensions
        $metadata = wp_get_attachment_metadata( $attachment_id );
        $img_url  = wp_get_attachment_url( $attachment_id );

        return $this->ok( [
            'id'     => $attachment_id,
            'url'    => $img_url,
            'width'  => $metadata['width'] ?? null,
            'height' => $metadata['height'] ?? null,
            'alt'    => $alt,
            'title'  => $title,
        ], 201 );
    }

    // -------------------------------------------------------------------------
    // Helpers — Elementor elements tree
    // -------------------------------------------------------------------------

    /**
     * Build a flat simplified widget list from an Elementor elements tree.
     * Recurses through containers/sections/columns. Returns only widgets (elType=widget).
     */
    private function simplify_elements( array $elements ): array {
        $result = [];

        foreach ( $elements as $element ) {
            if ( ! is_array( $element ) ) {
                continue;
            }

            $el_type     = $element['elType'] ?? '';
            $widget_type = $element['widgetType'] ?? '';
            $settings    = $element['settings'] ?? [];

            if ( $el_type === 'widget' ) {
                $item = [
                    'id'   => $element['id'] ?? '',
                    'type' => $widget_type,
                ];

                switch ( $widget_type ) {
                    case 'heading':
                        $item['text']         = wp_strip_all_tags( $settings['title'] ?? '' );
                        $item['heading_size'] = $settings['header_size'] ?? 'h2';
                        break;

                    case 'text-editor':
                        $item['text'] = wp_strip_all_tags( $settings['editor'] ?? '' );
                        break;

                    case 'image':
                        $item['url'] = $settings['image']['url'] ?? '';
                        $item['alt'] = $settings['image']['alt'] ?? '';
                        $item['id']  = $settings['image']['id'] ?? 0;
                        break;

                    case 'button':
                        $item['text'] = $settings['text'] ?? '';
                        $item['link'] = $settings['link']['url'] ?? '';
                        break;

                    case 'icon-box':
                        $item['title']       = wp_strip_all_tags( $settings['title_text'] ?? '' );
                        $item['description'] = wp_strip_all_tags( $settings['description_text'] ?? '' );
                        break;

                    case 'testimonial':
                        $item['content'] = wp_strip_all_tags( $settings['testimonial_content'] ?? '' );
                        $item['name']    = $settings['testimonial_name'] ?? '';
                        break;

                    default:
                        // Generic: first text-like setting
                        foreach ( [ 'title', 'text', 'editor', 'content', 'description' ] as $key ) {
                            if ( ! empty( $settings[ $key ] ) ) {
                                $item['text'] = wp_strip_all_tags( (string) $settings[ $key ] );
                                break;
                            }
                        }
                }

                $result[] = $item;
            }

            // Recurse into children (containers, sections, columns)
            if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
                foreach ( $this->simplify_elements( $element['elements'] ) as $child ) {
                    $result[] = $child;
                }
            }
        }

        return $result;
    }

    /**
     * Recursively traverse elements and apply one widget update in place.
     *
     * @param array &$elements  Live elements tree (modified in place)
     * @param array  $update    { id, type, text?, heading_size?, url?, alt?, attachment_id?, link? }
     * @return bool             True if widget was found and updated
     */
    private function apply_widget_update( array &$elements, array $update ): bool {
        $target_id = (string) ( $update['id'] ?? '' );

        foreach ( $elements as &$element ) {
            if ( ! is_array( $element ) ) {
                continue;
            }

            if ( (string) ( $element['id'] ?? '' ) === $target_id && ( $element['elType'] ?? '' ) === 'widget' ) {
                $widget_type = $element['widgetType'] ?? '';
                $this->merge_widget_settings( $element['settings'], $update, $widget_type );
                return true;
            }

            if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
                if ( $this->apply_widget_update( $element['elements'], $update ) ) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Map update fields to Elementor's internal settings keys per widget type.
     * Sanitizes all values before writing.
     *
     * @param array  &$settings  Widget settings array (modified in place)
     * @param array   $update    Incoming update payload
     * @param string  $type      Elementor widgetType
     */
    private function merge_widget_settings( array &$settings, array $update, string $type ): void {
        switch ( $type ) {
            case 'heading':
                if ( isset( $update['text'] ) ) {
                    $settings['title'] = wp_kses_post( $update['text'] );
                }
                if ( isset( $update['heading_size'] ) ) {
                    $size = strtolower( (string) $update['heading_size'] );
                    if ( in_array( $size, [ 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ], true ) ) {
                        $settings['header_size'] = $size;
                    }
                }
                break;

            case 'text-editor':
                if ( isset( $update['text'] ) ) {
                    $settings['editor'] = wp_kses_post( $update['text'] );
                }
                break;

            case 'image':
                if ( ! is_array( $settings['image'] ?? null ) ) {
                    $settings['image'] = [];
                }
                if ( isset( $update['url'] ) ) {
                    $settings['image']['url'] = esc_url_raw( $update['url'] );
                }
                if ( isset( $update['alt'] ) ) {
                    $settings['image']['alt'] = sanitize_text_field( $update['alt'] );
                }
                if ( isset( $update['attachment_id'] ) ) {
                    $settings['image']['id'] = (int) $update['attachment_id'];
                }
                break;

            case 'button':
                if ( isset( $update['text'] ) ) {
                    $settings['text'] = sanitize_text_field( $update['text'] );
                }
                if ( isset( $update['link'] ) ) {
                    if ( ! is_array( $settings['link'] ?? null ) ) {
                        $settings['link'] = [];
                    }
                    $settings['link']['url'] = esc_url_raw( $update['link'] );
                }
                break;

            case 'icon-box':
                if ( isset( $update['title'] ) ) {
                    $settings['title_text'] = wp_kses_post( $update['title'] );
                }
                if ( isset( $update['text'] ) ) {
                    $settings['description_text'] = wp_kses_post( $update['text'] );
                }
                break;

            default:
                // Generic fallback: write to first present text-like key
                if ( isset( $update['text'] ) ) {
                    foreach ( [ 'title', 'text', 'editor', 'content' ] as $key ) {
                        if ( array_key_exists( $key, $settings ) ) {
                            $settings[ $key ] = wp_kses_post( $update['text'] );
                            break;
                        }
                    }
                }
        }
    }

    /** Recursively regenerate element IDs (7-char hex). Used on import/template clone. */
    private function regenerate_element_ids( array $elements ): array {
        foreach ( $elements as &$el ) {
            if ( is_array( $el ) ) {
                $el['id'] = substr( bin2hex( random_bytes( 4 ) ), 0, 7 );
                if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
                    $el['elements'] = $this->regenerate_element_ids( $el['elements'] );
                }
            }
        }
        return $elements;
    }

    /**
     * Update the first text-editor widget found in an elements tree.
     * Used by handle_update() for Elementor posts with a plain content payload.
     */
    private function update_first_text_widget( array &$elements, string $content ): bool {
        foreach ( $elements as &$el ) {
            if ( ! is_array( $el ) ) {
                continue;
            }
            if ( ( $el['elType'] ?? '' ) === 'widget' && ( $el['widgetType'] ?? '' ) === 'text-editor' ) {
                $el['settings']['editor'] = $content;
                return true;
            }
            if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
                if ( $this->update_first_text_widget( $el['elements'], $content ) ) {
                    return true;
                }
            }
        }
        return false;
    }

    /** True if the post has Elementor data (not empty/falsy). */
    private function is_elementor_post( int $post_id ): bool {
        if ( ! $this->elementor_active() ) {
            return false;
        }
        $doc = \Elementor\Plugin::$instance->documents->get( $post_id );
        if ( ! $doc ) {
            return false;
        }
        $elements = $doc->get_elements_data();
        return ! empty( $elements );
    }

    /** Is Elementor plugin active and its instance available? */
    private function elementor_active(): bool {
        return class_exists( '\Elementor\Plugin' )
            && isset( \Elementor\Plugin::$instance )
            && \Elementor\Plugin::$instance instanceof \Elementor\Plugin;
    }

    // -------------------------------------------------------------------------
    // Response helpers
    // -------------------------------------------------------------------------

    private function ok( array $data, int $status = 200 ): WP_REST_Response {
        return new WP_REST_Response( array_merge( [ 'ok' => true ], $data ), $status );
    }

    private function error( string $code, string $message, int $status = 400 ): WP_REST_Response {
        return new WP_REST_Response( [
            'ok'      => false,
            'code'    => $code,
            'message' => $message,
        ], $status );
    }
}
