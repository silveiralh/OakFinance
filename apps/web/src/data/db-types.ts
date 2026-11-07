export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          archived_at: string | null;
          client_updated_at: string;
          color: string | null;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          icon: string | null;
          id: string;
          include_in_spendable: boolean;
          initial_balance_cents: number;
          initial_balance_on: string;
          institution: string | null;
          is_restricted: boolean;
          name: string;
          server_version: number;
          sort_order: number;
          type: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          client_updated_at?: string;
          color?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          icon?: string | null;
          id: string;
          include_in_spendable?: boolean;
          initial_balance_cents?: number;
          initial_balance_on?: string;
          institution?: string | null;
          is_restricted?: boolean;
          name: string;
          server_version?: number;
          sort_order?: number;
          type: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          archived_at?: string | null;
          client_updated_at?: string;
          color?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          icon?: string | null;
          id?: string;
          include_in_spendable?: boolean;
          initial_balance_cents?: number;
          initial_balance_on?: string;
          institution?: string | null;
          is_restricted?: boolean;
          name?: string;
          server_version?: number;
          sort_order?: number;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      bank_connections: {
        Row: {
          client_updated_at: string;
          connector_id: number | null;
          connector_name: string | null;
          consent_expires_at: string | null;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          execution_status: string | null;
          external_item_id: string;
          id: string;
          institution: string | null;
          is_active: boolean;
          last_error: string | null;
          last_manual_refresh_at: string | null;
          last_success_at: string | null;
          last_synced_at: string | null;
          provider: string;
          provider_updated_at: string | null;
          server_version: number;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          client_updated_at?: string;
          connector_id?: number | null;
          connector_name?: string | null;
          consent_expires_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          execution_status?: string | null;
          external_item_id: string;
          id: string;
          institution?: string | null;
          is_active?: boolean;
          last_error?: string | null;
          last_manual_refresh_at?: string | null;
          last_success_at?: string | null;
          last_synced_at?: string | null;
          provider?: string;
          provider_updated_at?: string | null;
          server_version?: number;
          status: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_updated_at?: string;
          connector_id?: number | null;
          connector_name?: string | null;
          consent_expires_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          execution_status?: string | null;
          external_item_id?: string;
          id?: string;
          institution?: string | null;
          is_active?: boolean;
          last_error?: string | null;
          last_manual_refresh_at?: string | null;
          last_success_at?: string | null;
          last_synced_at?: string | null;
          provider?: string;
          provider_updated_at?: string | null;
          server_version?: number;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      budgets: {
        Row: {
          alert_thresholds_bp: number[];
          bucket: string | null;
          category_id: string | null;
          client_updated_at: string;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          id: string;
          limit_cents: number | null;
          month: string | null;
          pct_bp: number | null;
          scope: string;
          server_version: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          alert_thresholds_bp?: number[];
          bucket?: string | null;
          category_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id: string;
          limit_cents?: number | null;
          month?: string | null;
          pct_bp?: number | null;
          scope: string;
          server_version?: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          alert_thresholds_bp?: number[];
          bucket?: string | null;
          category_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id?: string;
          limit_cents?: number | null;
          month?: string | null;
          pct_bp?: number | null;
          scope?: string;
          server_version?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budgets_user_id_category_id_fkey';
            columns: ['user_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      cards: {
        Row: {
          archived_at: string | null;
          brand: string | null;
          client_updated_at: string;
          closing_day: number;
          closing_day_rule: string;
          color: string | null;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          due_day: number;
          icon: string | null;
          id: string;
          institution: string | null;
          last4: string | null;
          limit_cents: number | null;
          name: string;
          payment_account_id: string | null;
          server_version: number;
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          brand?: string | null;
          client_updated_at?: string;
          closing_day: number;
          closing_day_rule?: string;
          color?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          due_day: number;
          icon?: string | null;
          id: string;
          institution?: string | null;
          last4?: string | null;
          limit_cents?: number | null;
          name: string;
          payment_account_id?: string | null;
          server_version?: number;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          archived_at?: string | null;
          brand?: string | null;
          client_updated_at?: string;
          closing_day?: number;
          closing_day_rule?: string;
          color?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          due_day?: number;
          icon?: string | null;
          id?: string;
          institution?: string | null;
          last4?: string | null;
          limit_cents?: number | null;
          name?: string;
          payment_account_id?: string | null;
          server_version?: number;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cards_user_id_payment_account_id_fkey';
            columns: ['user_id', 'payment_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      categories: {
        Row: {
          archived_at: string | null;
          bucket: string;
          client_updated_at: string;
          color: string | null;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          feeds_reserve: boolean;
          icon: string | null;
          id: string;
          is_default: boolean;
          is_system: boolean;
          kind: string;
          name: string;
          name_ci: string | null;
          parent_id: string | null;
          server_version: number;
          slug: string | null;
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          bucket: string;
          client_updated_at?: string;
          color?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          feeds_reserve?: boolean;
          icon?: string | null;
          id: string;
          is_default?: boolean;
          is_system?: boolean;
          kind: string;
          name: string;
          name_ci?: never;
          parent_id?: string | null;
          server_version?: number;
          slug?: string | null;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          archived_at?: string | null;
          bucket?: string;
          client_updated_at?: string;
          color?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          feeds_reserve?: boolean;
          icon?: string | null;
          id?: string;
          is_default?: boolean;
          is_system?: boolean;
          kind?: string;
          name?: string;
          name_ci?: never;
          parent_id?: string | null;
          server_version?: number;
          slug?: string | null;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_user_id_parent_id_fkey';
            columns: ['user_id', 'parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      category_rules: {
        Row: {
          account_id: string | null;
          card_id: string | null;
          category_id: string;
          client_updated_at: string;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          enabled: boolean;
          hits: number;
          id: string;
          last_hit_at: string | null;
          match_field: string;
          match_type: string;
          pattern: string;
          payment_method: string | null;
          priority: number;
          server_version: number;
          source: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          card_id?: string | null;
          category_id: string;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          enabled?: boolean;
          hits?: number;
          id: string;
          last_hit_at?: string | null;
          match_field?: string;
          match_type?: string;
          pattern: string;
          payment_method?: string | null;
          priority?: number;
          server_version?: number;
          source: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          account_id?: string | null;
          card_id?: string | null;
          category_id?: string;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          enabled?: boolean;
          hits?: number;
          id?: string;
          last_hit_at?: string | null;
          match_field?: string;
          match_type?: string;
          pattern?: string;
          payment_method?: string | null;
          priority?: number;
          server_version?: number;
          source?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'category_rules_user_id_account_id_fkey';
            columns: ['user_id', 'account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'category_rules_user_id_card_id_fkey';
            columns: ['user_id', 'card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'category_rules_user_id_category_id_fkey';
            columns: ['user_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      external_accounts: {
        Row: {
          account_id: string | null;
          available_limit_cents: number | null;
          backfill_done_at: string | null;
          balance_cents: number | null;
          balance_close_date: string | null;
          balance_due_date: string | null;
          card_id: string | null;
          client_updated_at: string;
          connection_id: string;
          created_at: string;
          credit_limit_cents: number | null;
          deleted_at: string | null;
          device_id: string | null;
          external_account_id: string;
          id: string;
          is_ignored: boolean;
          last_tx_date: string | null;
          name: string | null;
          number_masked: string | null;
          server_version: number;
          subtype: string;
          type: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          available_limit_cents?: number | null;
          backfill_done_at?: string | null;
          balance_cents?: number | null;
          balance_close_date?: string | null;
          balance_due_date?: string | null;
          card_id?: string | null;
          client_updated_at?: string;
          connection_id: string;
          created_at?: string;
          credit_limit_cents?: number | null;
          deleted_at?: string | null;
          device_id?: string | null;
          external_account_id: string;
          id: string;
          is_ignored?: boolean;
          last_tx_date?: string | null;
          name?: string | null;
          number_masked?: string | null;
          server_version?: number;
          subtype: string;
          type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          available_limit_cents?: number | null;
          backfill_done_at?: string | null;
          balance_cents?: number | null;
          balance_close_date?: string | null;
          balance_due_date?: string | null;
          card_id?: string | null;
          client_updated_at?: string;
          connection_id?: string;
          created_at?: string;
          credit_limit_cents?: number | null;
          deleted_at?: string | null;
          device_id?: string | null;
          external_account_id?: string;
          id?: string;
          is_ignored?: boolean;
          last_tx_date?: string | null;
          name?: string | null;
          number_masked?: string | null;
          server_version?: number;
          subtype?: string;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'external_accounts_user_id_account_id_fkey';
            columns: ['user_id', 'account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'external_accounts_user_id_card_id_fkey';
            columns: ['user_id', 'card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'external_accounts_user_id_connection_id_fkey';
            columns: ['user_id', 'connection_id'];
            isOneToOne: false;
            referencedRelation: 'bank_connections';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      goals: {
        Row: {
          account_id: string | null;
          achieved_at: string | null;
          auto_factor: number;
          auto_lookback_months: number;
          client_updated_at: string;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          id: string;
          initial_saved_cents: number;
          kind: string;
          name: string;
          server_version: number;
          target_cents: number | null;
          target_mode: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          achieved_at?: string | null;
          auto_factor?: number;
          auto_lookback_months?: number;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id: string;
          initial_saved_cents?: number;
          kind: string;
          name: string;
          server_version?: number;
          target_cents?: number | null;
          target_mode?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          account_id?: string | null;
          achieved_at?: string | null;
          auto_factor?: number;
          auto_lookback_months?: number;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id?: string;
          initial_saved_cents?: number;
          kind?: string;
          name?: string;
          server_version?: number;
          target_cents?: number | null;
          target_mode?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'goals_user_id_account_id_fkey';
            columns: ['user_id', 'account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      imports: {
        Row: {
          account_id: string | null;
          card_id: string | null;
          client_updated_at: string;
          created_at: string;
          csv_profile: string | null;
          deleted_at: string | null;
          device_id: string | null;
          error: string | null;
          file_name: string | null;
          file_sha256: string | null;
          id: string;
          period_end: string | null;
          period_start: string | null;
          server_version: number;
          source: string;
          stats: NonNullable<Json>;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          card_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          csv_profile?: string | null;
          deleted_at?: string | null;
          device_id?: string | null;
          error?: string | null;
          file_name?: string | null;
          file_sha256?: string | null;
          id: string;
          period_end?: string | null;
          period_start?: string | null;
          server_version?: number;
          source: string;
          stats?: NonNullable<Json>;
          status: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          account_id?: string | null;
          card_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          csv_profile?: string | null;
          deleted_at?: string | null;
          device_id?: string | null;
          error?: string | null;
          file_name?: string | null;
          file_sha256?: string | null;
          id?: string;
          period_end?: string | null;
          period_start?: string | null;
          server_version?: number;
          source?: string;
          stats?: NonNullable<Json>;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'imports_user_id_account_id_fkey';
            columns: ['user_id', 'account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'imports_user_id_card_id_fkey';
            columns: ['user_id', 'card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      installment_plans: {
        Row: {
          account_id: string | null;
          card_id: string | null;
          category_id: string | null;
          client_updated_at: string;
          created_at: string;
          deleted_at: string | null;
          description: string;
          device_id: string | null;
          first_due_on: string | null;
          first_installment_cents: number | null;
          id: string;
          installments_count: number;
          payment_method: string;
          purchase_date: string;
          server_version: number;
          source: string;
          start_installment: number;
          total_cents: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          card_id?: string | null;
          category_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          description: string;
          device_id?: string | null;
          first_due_on?: string | null;
          first_installment_cents?: number | null;
          id: string;
          installments_count: number;
          payment_method?: string;
          purchase_date: string;
          server_version?: number;
          source?: string;
          start_installment?: number;
          total_cents: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          account_id?: string | null;
          card_id?: string | null;
          category_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string;
          device_id?: string | null;
          first_due_on?: string | null;
          first_installment_cents?: number | null;
          id?: string;
          installments_count?: number;
          payment_method?: string;
          purchase_date?: string;
          server_version?: number;
          source?: string;
          start_installment?: number;
          total_cents?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'installment_plans_user_id_account_id_fkey';
            columns: ['user_id', 'account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'installment_plans_user_id_card_id_fkey';
            columns: ['user_id', 'card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'installment_plans_user_id_category_id_fkey';
            columns: ['user_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      invoices: {
        Row: {
          card_id: string;
          client_updated_at: string;
          closing_date: string;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          due_date: string;
          external_bill_id: string | null;
          external_min_payment_cents: number | null;
          external_total_cents: number | null;
          id: string;
          is_manual_dates: boolean;
          notes: string | null;
          reference_month: string;
          server_version: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          card_id: string;
          client_updated_at?: string;
          closing_date: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          due_date: string;
          external_bill_id?: string | null;
          external_min_payment_cents?: number | null;
          external_total_cents?: number | null;
          id: string;
          is_manual_dates?: boolean;
          notes?: string | null;
          reference_month: string;
          server_version?: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          card_id?: string;
          client_updated_at?: string;
          closing_date?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          due_date?: string;
          external_bill_id?: string | null;
          external_min_payment_cents?: number | null;
          external_total_cents?: number | null;
          id?: string;
          is_manual_dates?: boolean;
          notes?: string | null;
          reference_month?: string;
          server_version?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_user_id_card_id_fkey';
            columns: ['user_id', 'card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      month_closings: {
        Row: {
          client_updated_at: string;
          closed_at: string | null;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          id: string;
          month: string;
          server_version: number;
          snapshot: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          client_updated_at?: string;
          closed_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id: string;
          month: string;
          server_version?: number;
          snapshot?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          client_updated_at?: string;
          closed_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id?: string;
          month?: string;
          server_version?: number;
          snapshot?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      nfce_receipts: {
        Row: {
          access_key: string;
          client_updated_at: string;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          discount_cents: number | null;
          error_code: string | null;
          fetched_at: string | null;
          id: string;
          issued_on: string | null;
          issuer_cnpj: string;
          issuer_name: string | null;
          items_count: number | null;
          parse_status: string;
          parser_version: string | null;
          qr_url: string;
          qr_version: number;
          server_version: number;
          total_cents: number | null;
          uf: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          access_key: string;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          discount_cents?: number | null;
          error_code?: string | null;
          fetched_at?: string | null;
          id: string;
          issued_on?: string | null;
          issuer_cnpj: string;
          issuer_name?: string | null;
          items_count?: number | null;
          parse_status: string;
          parser_version?: string | null;
          qr_url: string;
          qr_version: number;
          server_version?: number;
          total_cents?: number | null;
          uf: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          access_key?: string;
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          discount_cents?: number | null;
          error_code?: string | null;
          fetched_at?: string | null;
          id?: string;
          issued_on?: string | null;
          issuer_cnpj?: string;
          issuer_name?: string | null;
          items_count?: number | null;
          parse_status?: string;
          parser_version?: string | null;
          qr_url?: string;
          qr_version?: number;
          server_version?: number;
          total_cents?: number | null;
          uf?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notices: {
        Row: {
          body: string;
          client_updated_at: string;
          created_at: string;
          dedupe_key: string;
          deleted_at: string | null;
          device_id: string | null;
          id: string;
          kind: string;
          navigate: string;
          read_at: string | null;
          server_version: number;
          title: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          client_updated_at?: string;
          created_at?: string;
          dedupe_key: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id: string;
          kind: string;
          navigate: string;
          read_at?: string | null;
          server_version?: number;
          title: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          body?: string;
          client_updated_at?: string;
          created_at?: string;
          dedupe_key?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          id?: string;
          kind?: string;
          navigate?: string;
          read_at?: string | null;
          server_version?: number;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          created_at: string;
          dedupe_key: string;
          error: string | null;
          id: string;
          kind: string;
          payload: NonNullable<Json>;
          scheduled_for: string;
          sent_at: string | null;
          status: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          created_at?: string;
          dedupe_key: string;
          error?: string | null;
          id?: string;
          kind: string;
          payload: NonNullable<Json>;
          scheduled_for?: string;
          sent_at?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          dedupe_key?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          payload?: NonNullable<Json>;
          scheduled_for?: string;
          sent_at?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          client_updated_at: string;
          created_at: string;
          deleted_at: string | null;
          device_id: string | null;
          display_name: string | null;
          id: string;
          onboarding: NonNullable<Json>;
          server_version: number;
          settings: NonNullable<Json>;
          timezone: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          display_name?: string | null;
          id: string;
          onboarding?: NonNullable<Json>;
          server_version?: number;
          settings?: NonNullable<Json>;
          timezone?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_updated_at?: string;
          created_at?: string;
          deleted_at?: string | null;
          device_id?: string | null;
          display_name?: string | null;
          id?: string;
          onboarding?: NonNullable<Json>;
          server_version?: number;
          settings?: NonNullable<Json>;
          timezone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          device_id: string | null;
          disabled_at: string | null;
          endpoint: string;
          failure_count: number;
          id: string;
          last_failure_at: string | null;
          last_success_at: string | null;
          p256dh: string;
          platform: string;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          device_id?: string | null;
          disabled_at?: string | null;
          endpoint: string;
          failure_count?: number;
          id?: string;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          p256dh: string;
          platform: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          device_id?: string | null;
          disabled_at?: string | null;
          endpoint?: string;
          failure_count?: number;
          id?: string;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          p256dh?: string;
          platform?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      receipt_items: {
        Row: {
          category_id: string | null;
          client_updated_at: string;
          code: string | null;
          created_at: string;
          deleted_at: string | null;
          description: string;
          device_id: string | null;
          id: string;
          line_no: number;
          quantity_milli: number;
          receipt_id: string;
          server_version: number;
          total_cents: number;
          unit: string | null;
          unit_price_cents: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          category_id?: string | null;
          client_updated_at?: string;
          code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description: string;
          device_id?: string | null;
          id: string;
          line_no: number;
          quantity_milli: number;
          receipt_id: string;
          server_version?: number;
          total_cents: number;
          unit?: string | null;
          unit_price_cents: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          category_id?: string | null;
          client_updated_at?: string;
          code?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string;
          device_id?: string | null;
          id?: string;
          line_no?: number;
          quantity_milli?: number;
          receipt_id?: string;
          server_version?: number;
          total_cents?: number;
          unit?: string | null;
          unit_price_cents?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_items_user_id_category_id_fkey';
            columns: ['user_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'receipt_items_user_id_receipt_id_fkey';
            columns: ['user_id', 'receipt_id'];
            isOneToOne: false;
            referencedRelation: 'nfce_receipts';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      recurrences: {
        Row: {
          account_id: string | null;
          amount_cents: number;
          auto_post: boolean;
          card_id: string | null;
          category_id: string | null;
          client_updated_at: string;
          created_at: string;
          day_of_month: number | null;
          deleted_at: string | null;
          description: string;
          device_id: string | null;
          end_on: string | null;
          frequency: string;
          id: string;
          interval_count: number;
          is_fixed_income: boolean;
          is_variable_amount: boolean;
          kind: string;
          match_pattern: string | null;
          max_occurrences: number | null;
          month_of_year: number | null;
          paused_at: string | null;
          payment_method: string;
          remind: boolean;
          server_version: number;
          start_on: string;
          updated_at: string;
          user_id: string;
          weekday: number | null;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          amount_cents: number;
          auto_post?: boolean;
          card_id?: string | null;
          category_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          day_of_month?: number | null;
          deleted_at?: string | null;
          description: string;
          device_id?: string | null;
          end_on?: string | null;
          frequency: string;
          id: string;
          interval_count?: number;
          is_fixed_income?: boolean;
          is_variable_amount?: boolean;
          kind: string;
          match_pattern?: string | null;
          max_occurrences?: number | null;
          month_of_year?: number | null;
          paused_at?: string | null;
          payment_method: string;
          remind?: boolean;
          server_version?: number;
          start_on: string;
          updated_at?: string;
          user_id?: string;
          weekday?: number | null;
        };
        Update: {
          account_id?: string | null;
          amount_cents?: number;
          auto_post?: boolean;
          card_id?: string | null;
          category_id?: string | null;
          client_updated_at?: string;
          created_at?: string;
          day_of_month?: number | null;
          deleted_at?: string | null;
          description?: string;
          device_id?: string | null;
          end_on?: string | null;
          frequency?: string;
          id?: string;
          interval_count?: number;
          is_fixed_income?: boolean;
          is_variable_amount?: boolean;
          kind?: string;
          match_pattern?: string | null;
          max_occurrences?: number | null;
          month_of_year?: number | null;
          paused_at?: string | null;
          payment_method?: string;
          remind?: boolean;
          server_version?: number;
          start_on?: string;
          updated_at?: string;
          user_id?: string;
          weekday?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'recurrences_user_id_account_id_fkey';
            columns: ['user_id', 'account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'recurrences_user_id_card_id_fkey';
            columns: ['user_id', 'card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'recurrences_user_id_category_id_fkey';
            columns: ['user_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      reminders: {
        Row: {
          client_updated_at: string;
          created_at: string;
          days_before: number[];
          deleted_at: string | null;
          device_id: string | null;
          enabled: boolean;
          id: string;
          kind: string;
          local_time: string;
          server_version: number;
          skip_if_logged_today: boolean;
          updated_at: string;
          user_id: string;
          weekday: number | null;
        };
        ComputedFields: never;
        Insert: {
          client_updated_at?: string;
          created_at?: string;
          days_before?: number[];
          deleted_at?: string | null;
          device_id?: string | null;
          enabled?: boolean;
          id: string;
          kind: string;
          local_time?: string;
          server_version?: number;
          skip_if_logged_today?: boolean;
          updated_at?: string;
          user_id?: string;
          weekday?: number | null;
        };
        Update: {
          client_updated_at?: string;
          created_at?: string;
          days_before?: number[];
          deleted_at?: string | null;
          device_id?: string | null;
          enabled?: boolean;
          id?: string;
          kind?: string;
          local_time?: string;
          server_version?: number;
          skip_if_logged_today?: boolean;
          updated_at?: string;
          user_id?: string;
          weekday?: number | null;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          account_id: string | null;
          amount_cents: number;
          card_id: string | null;
          category_id: string | null;
          category_rule_id: string | null;
          category_source: string;
          client_updated_at: string;
          count_before_received: boolean;
          counterpart_account_id: string | null;
          counterpart_card_id: string | null;
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          description_raw: string | null;
          device_id: string | null;
          duplicate_of: string | null;
          external_id: string | null;
          external_meta: Json | null;
          goal_id: string | null;
          id: string;
          import_id: string | null;
          income_expected: boolean;
          installment_count: number | null;
          installment_number: number | null;
          invoice_id: string | null;
          invoice_pinned: boolean;
          kind: string;
          matched_external: boolean;
          merchant_cnpj: string | null;
          merchant_name: string | null;
          nfce_receipt_id: string | null;
          notes: string | null;
          occurred_at: string | null;
          occurred_on: string;
          payment_method: string;
          recurrence_date: string | null;
          recurrence_id: string | null;
          review_state: string;
          series_id: string | null;
          server_version: number;
          source: string;
          status: string;
          tags: string[];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          amount_cents: number;
          card_id?: string | null;
          category_id?: string | null;
          category_rule_id?: string | null;
          category_source?: string;
          client_updated_at?: string;
          count_before_received?: boolean;
          counterpart_account_id?: string | null;
          counterpart_card_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          description_raw?: string | null;
          device_id?: string | null;
          duplicate_of?: string | null;
          external_id?: string | null;
          external_meta?: Json | null;
          goal_id?: string | null;
          id: string;
          import_id?: string | null;
          income_expected?: boolean;
          installment_count?: number | null;
          installment_number?: number | null;
          invoice_id?: string | null;
          invoice_pinned?: boolean;
          kind: string;
          matched_external?: boolean;
          merchant_cnpj?: string | null;
          merchant_name?: string | null;
          nfce_receipt_id?: string | null;
          notes?: string | null;
          occurred_at?: string | null;
          occurred_on: string;
          payment_method: string;
          recurrence_date?: string | null;
          recurrence_id?: string | null;
          review_state?: string;
          series_id?: string | null;
          server_version?: number;
          source?: string;
          status?: string;
          tags?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          account_id?: string | null;
          amount_cents?: number;
          card_id?: string | null;
          category_id?: string | null;
          category_rule_id?: string | null;
          category_source?: string;
          client_updated_at?: string;
          count_before_received?: boolean;
          counterpart_account_id?: string | null;
          counterpart_card_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          description_raw?: string | null;
          device_id?: string | null;
          duplicate_of?: string | null;
          external_id?: string | null;
          external_meta?: Json | null;
          goal_id?: string | null;
          id?: string;
          import_id?: string | null;
          income_expected?: boolean;
          installment_count?: number | null;
          installment_number?: number | null;
          invoice_id?: string | null;
          invoice_pinned?: boolean;
          kind?: string;
          matched_external?: boolean;
          merchant_cnpj?: string | null;
          merchant_name?: string | null;
          nfce_receipt_id?: string | null;
          notes?: string | null;
          occurred_at?: string | null;
          occurred_on?: string;
          payment_method?: string;
          recurrence_date?: string | null;
          recurrence_id?: string | null;
          review_state?: string;
          series_id?: string | null;
          server_version?: number;
          source?: string;
          status?: string;
          tags?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_user_id_account_id_fkey';
            columns: ['user_id', 'account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_card_id_fkey';
            columns: ['user_id', 'card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_category_id_fkey';
            columns: ['user_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_category_rule_id_fkey';
            columns: ['user_id', 'category_rule_id'];
            isOneToOne: false;
            referencedRelation: 'category_rules';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_counterpart_account_id_fkey';
            columns: ['user_id', 'counterpart_account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_counterpart_card_id_fkey';
            columns: ['user_id', 'counterpart_card_id'];
            isOneToOne: false;
            referencedRelation: 'cards';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_duplicate_of_fkey';
            columns: ['user_id', 'duplicate_of'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_goal_id_fkey';
            columns: ['user_id', 'goal_id'];
            isOneToOne: false;
            referencedRelation: 'goals';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_import_id_fkey';
            columns: ['user_id', 'import_id'];
            isOneToOne: false;
            referencedRelation: 'imports';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_invoice_id_fkey';
            columns: ['user_id', 'invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_nfce_receipt_id_fkey';
            columns: ['user_id', 'nfce_receipt_id'];
            isOneToOne: false;
            referencedRelation: 'nfce_receipts';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_recurrence_id_fkey';
            columns: ['user_id', 'recurrence_id'];
            isOneToOne: false;
            referencedRelation: 'recurrences';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'transactions_user_id_series_id_fkey';
            columns: ['user_id', 'series_id'];
            isOneToOne: false;
            referencedRelation: 'installment_plans';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      delete_push_subscription: { Args: { p_endpoint: string }; Returns: undefined };
      get_row_history: { Args: { p_row_id: string; p_table: string }; Returns: Json[] };
      hook_before_user_created: { Args: { event: Json }; Returns: Json };
      log_events: { Args: { p_events: Json }; Returns: undefined };
      map_external_account: {
        Args: { p_account_id: string; p_card_id: string; p_id: string; p_is_ignored: boolean };
        Returns: undefined;
      };
      ops_health: { Args: Record<PropertyKey, never>; Returns: Json };
      ping: { Args: Record<PropertyKey, never>; Returns: string };
      reminders_tick_claim: { Args: { p_limit?: number; p_now?: string }; Returns: Json };
      reminders_tick_context: { Args: { p_now?: string; p_user: string }; Returns: Json };
      reminders_tick_finish: {
        Args: { p_error?: string; p_run: number; p_stats: Json; p_status: string };
        Returns: undefined;
      };
      reminders_tick_record: {
        Args: { p_now: string; p_outbox: Json; p_subs: Json };
        Returns: undefined;
      };
      reminders_tick_save: {
        Args: { p_notices: Json; p_outbox: Json; p_user: string };
        Returns: number;
      };
      reminders_tick_snapshot: { Args: { p_now?: string }; Returns: Json };
      reminders_tick_start: { Args: Record<PropertyKey, never>; Returns: number };
      sync_pull: { Args: { p_limit?: number; p_since: number }; Returns: Json };
      sync_push: { Args: { p_device_id: string; p_mutations: Json }; Returns: Json };
      upsert_push_subscription: {
        Args: {
          p_auth: string;
          p_device_id: string;
          p_endpoint: string;
          p_p256dh: string;
          p_platform: string;
          p_user_agent: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
