export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action_type: string
          event_source: string | null
          event_type: Database["public"]["Enums"]["audit_event_type"]
          job_id: string | null
          log_id: string
          new_value: Json | null
          old_value: Json | null
          performed_by: string | null
          timestamp: string
        }
        Insert: {
          action_type: string
          event_source?: string | null
          event_type?: Database["public"]["Enums"]["audit_event_type"]
          job_id?: string | null
          log_id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by?: string | null
          timestamp?: string
        }
        Update: {
          action_type?: string
          event_source?: string | null
          event_type?: Database["public"]["Enums"]["audit_event_type"]
          job_id?: string | null
          log_id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      dispatch_offers: {
        Row: {
          created_at: string
          driver_id: string
          expires_at: string | null
          job_id: string
          offer_id: string
          offer_status: Database["public"]["Enums"]["offer_status"]
          response_time: number | null
          token: string | null
          truck_id: string | null
        }
        Insert: {
          created_at?: string
          driver_id: string
          expires_at?: string | null
          job_id: string
          offer_id?: string
          offer_status?: Database["public"]["Enums"]["offer_status"]
          response_time?: number | null
          token?: string | null
          truck_id?: string | null
        }
        Update: {
          created_at?: string
          driver_id?: string
          expires_at?: string | null
          job_id?: string
          offer_id?: string
          offer_status?: Database["public"]["Enums"]["offer_status"]
          response_time?: number | null
          token?: string | null
          truck_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_offers_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "dispatch_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "dispatch_offers_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["truck_id"]
          },
        ]
      }
      driver_location_updates: {
        Row: {
          driver_id: string
          heading: number | null
          id: string
          job_id: string
          lat: number
          lng: number
          recorded_at: string | null
          speed_kmh: number | null
        }
        Insert: {
          driver_id: string
          heading?: number | null
          id?: string
          job_id: string
          lat: number
          lng: number
          recorded_at?: string | null
          speed_kmh?: number | null
        }
        Update: {
          driver_id?: string
          heading?: number | null
          id?: string
          job_id?: string
          lat?: number
          lng?: number
          recorded_at?: string | null
          speed_kmh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_location_updates_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_location_updates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      drivers: {
        Row: {
          availability_status: Database["public"]["Enums"]["driver_availability"]
          company_name: string | null
          created_at: string
          driver_id: string
          driver_name: string
          gps_lat: number | null
          gps_long: number | null
          phone: string | null
          rating: number | null
          reliability_score: number | null
          review_count: number | null
          service_radius_km: number | null
          updated_at: string
        }
        Insert: {
          availability_status?: Database["public"]["Enums"]["driver_availability"]
          company_name?: string | null
          created_at?: string
          driver_id?: string
          driver_name: string
          gps_lat?: number | null
          gps_long?: number | null
          phone?: string | null
          rating?: number | null
          reliability_score?: number | null
          review_count?: number | null
          service_radius_km?: number | null
          updated_at?: string
        }
        Update: {
          availability_status?: Database["public"]["Enums"]["driver_availability"]
          company_name?: string | null
          created_at?: string
          driver_id?: string
          driver_name?: string
          gps_lat?: number | null
          gps_long?: number | null
          phone?: string | null
          rating?: number | null
          reliability_score?: number | null
          review_count?: number | null
          service_radius_km?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          description: string | null
          equipment_id: string
          name: string
        }
        Insert: {
          description?: string | null
          equipment_id?: string
          name: string
        }
        Update: {
          description?: string | null
          equipment_id?: string
          name?: string
        }
        Relationships: []
      }
      incident_types: {
        Row: {
          complexity_level: number | null
          default_truck_type_id: string | null
          description: string | null
          incident_name: string
          incident_type_id: string
          requires_special_equipment: Json | null
        }
        Insert: {
          complexity_level?: number | null
          default_truck_type_id?: string | null
          description?: string | null
          incident_name: string
          incident_type_id?: string
          requires_special_equipment?: Json | null
        }
        Update: {
          complexity_level?: number | null
          default_truck_type_id?: string | null
          description?: string | null
          incident_name?: string
          incident_type_id?: string
          requires_special_equipment?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_types_default_truck_type_id_fkey"
            columns: ["default_truck_type_id"]
            isOneToOne: false
            referencedRelation: "truck_types"
            referencedColumns: ["truck_type_id"]
          },
        ]
      }
      job_events: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          created_at: string
          event_category: string
          event_id: string
          event_status: string | null
          event_type: string
          job_id: string
          message: string | null
          new_value: Json | null
          old_value: Json | null
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string
          event_category: string
          event_id?: string
          event_status?: string | null
          event_type: string
          job_id: string
          message?: string | null
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string
          event_category?: string
          event_id?: string
          event_status?: string | null
          event_type?: string
          job_id?: string
          message?: string | null
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      jobs: {
        Row: {
          amendment_reason: string | null
          assigned_driver_id: string | null
          assigned_truck_id: string | null
          authorization_status: string | null
          can_vehicle_roll: boolean | null
          cancellation_fee: number | null
          cancellation_fee_amount: number | null
          cancellation_fee_applicable: boolean | null
          cancellation_fee_reason: string | null
          cancelled_by: string | null
          cancelled_reason: string | null
          created_at: string
          customer_update_message: string | null
          dispatch_attempt_count: number
          dispatch_priority_score: number | null
          estimated_price: number | null
          eta_minutes: number | null
          gps_lat: number | null
          gps_long: number | null
          incident_type_id: string | null
          job_id: string
          job_status: Database["public"]["Enums"]["job_status"]
          language: string | null
          location_type: string | null
          pickup_location: string | null
          reassignment_reason: string | null
          required_equipment: Json | null
          required_truck_type_id: string | null
          reservation_expires_at: string | null
          reserved_driver_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string | null
          vehicle_condition: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
        }
        Insert: {
          amendment_reason?: string | null
          assigned_driver_id?: string | null
          assigned_truck_id?: string | null
          authorization_status?: string | null
          can_vehicle_roll?: boolean | null
          cancellation_fee?: number | null
          cancellation_fee_amount?: number | null
          cancellation_fee_applicable?: boolean | null
          cancellation_fee_reason?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          customer_update_message?: string | null
          dispatch_attempt_count?: number
          dispatch_priority_score?: number | null
          estimated_price?: number | null
          eta_minutes?: number | null
          gps_lat?: number | null
          gps_long?: number | null
          incident_type_id?: string | null
          job_id?: string
          job_status?: Database["public"]["Enums"]["job_status"]
          language?: string | null
          location_type?: string | null
          pickup_location?: string | null
          reassignment_reason?: string | null
          required_equipment?: Json | null
          required_truck_type_id?: string | null
          reservation_expires_at?: string | null
          reserved_driver_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_condition?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Update: {
          amendment_reason?: string | null
          assigned_driver_id?: string | null
          assigned_truck_id?: string | null
          authorization_status?: string | null
          can_vehicle_roll?: boolean | null
          cancellation_fee?: number | null
          cancellation_fee_amount?: number | null
          cancellation_fee_applicable?: boolean | null
          cancellation_fee_reason?: string | null
          cancelled_by?: string | null
          cancelled_reason?: string | null
          created_at?: string
          customer_update_message?: string | null
          dispatch_attempt_count?: number
          dispatch_priority_score?: number | null
          estimated_price?: number | null
          eta_minutes?: number | null
          gps_lat?: number | null
          gps_long?: number | null
          incident_type_id?: string | null
          job_id?: string
          job_status?: Database["public"]["Enums"]["job_status"]
          language?: string | null
          location_type?: string | null
          pickup_location?: string | null
          reassignment_reason?: string | null
          required_equipment?: Json | null
          required_truck_type_id?: string | null
          reservation_expires_at?: string | null
          reserved_driver_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_condition?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_driver_id_fkey"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "jobs_assigned_truck_id_fkey"
            columns: ["assigned_truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["truck_id"]
          },
          {
            foreignKeyName: "jobs_incident_type_id_fkey"
            columns: ["incident_type_id"]
            isOneToOne: false
            referencedRelation: "incident_types"
            referencedColumns: ["incident_type_id"]
          },
          {
            foreignKeyName: "jobs_required_truck_type_id_fkey"
            columns: ["required_truck_type_id"]
            isOneToOne: false
            referencedRelation: "truck_types"
            referencedColumns: ["truck_type_id"]
          },
          {
            foreignKeyName: "jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          base_fee: number
          complexity_surcharge: number | null
          distance_rate_per_km: number
          equipment_surcharge: number | null
          incident_type_id: string
          minimum_authorization: number | null
          rule_id: string
        }
        Insert: {
          base_fee: number
          complexity_surcharge?: number | null
          distance_rate_per_km?: number
          equipment_surcharge?: number | null
          incident_type_id: string
          minimum_authorization?: number | null
          rule_id?: string
        }
        Update: {
          base_fee?: number
          complexity_surcharge?: number | null
          distance_rate_per_km?: number
          equipment_surcharge?: number | null
          incident_type_id?: string
          minimum_authorization?: number | null
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_incident_type_id_fkey"
            columns: ["incident_type_id"]
            isOneToOne: false
            referencedRelation: "incident_types"
            referencedColumns: ["incident_type_id"]
          },
        ]
      }
      reviews: {
        Row: {
          comments: string | null
          created_at: string
          driver_id: string
          job_id: string
          rating: number
          review_id: string
        }
        Insert: {
          comments?: string | null
          created_at?: string
          driver_id: string
          job_id: string
          rating: number
          review_id?: string
        }
        Update: {
          comments?: string | null
          created_at?: string
          driver_id?: string
          job_id?: string
          rating?: number
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      truck_equipment: {
        Row: {
          equipment_id: string
          truck_id: string
        }
        Insert: {
          equipment_id: string
          truck_id: string
        }
        Update: {
          equipment_id?: string
          truck_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "truck_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "truck_equipment_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "trucks"
            referencedColumns: ["truck_id"]
          },
        ]
      }
      truck_types: {
        Row: {
          created_at: string
          description: string | null
          max_weight_capacity: number | null
          name: string
          truck_type_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          max_weight_capacity?: number | null
          name: string
          truck_type_id?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          max_weight_capacity?: number | null
          name?: string
          truck_type_id?: string
        }
        Relationships: []
      }
      trucks: {
        Row: {
          clearance_height: number | null
          created_at: string
          driver_id: string
          max_vehicle_weight: number | null
          status: Database["public"]["Enums"]["truck_status"]
          truck_id: string
          truck_type_id: string
          updated_at: string
          winch_capacity: number | null
        }
        Insert: {
          clearance_height?: number | null
          created_at?: string
          driver_id: string
          max_vehicle_weight?: number | null
          status?: Database["public"]["Enums"]["truck_status"]
          truck_id?: string
          truck_type_id: string
          updated_at?: string
          winch_capacity?: number | null
        }
        Update: {
          clearance_height?: number | null
          created_at?: string
          driver_id?: string
          max_vehicle_weight?: number | null
          status?: Database["public"]["Enums"]["truck_status"]
          truck_id?: string
          truck_type_id?: string
          updated_at?: string
          winch_capacity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trucks_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "trucks_truck_type_id_fkey"
            columns: ["truck_type_id"]
            isOneToOne: false
            referencedRelation: "truck_types"
            referencedColumns: ["truck_type_id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string | null
          license_plate: string | null
          name: string
          payment_token_reference: string | null
          phone: string | null
          updated_at: string
          user_id: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          license_plate?: string | null
          name: string
          payment_token_reference?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Update: {
          created_at?: string
          email?: string | null
          license_plate?: string | null
          name?: string
          payment_token_reference?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      audit_event_type:
        | "job_created"
        | "job_updated"
        | "status_changed"
        | "driver_assigned"
        | "offer_sent"
        | "offer_responded"
        | "system_event"
        | "amendment_requested"
        | "reassignment_requested"
        | "driver_unavailable"
        | "job_cancelled"
        | "customer_update"
      driver_availability: "available" | "busy" | "offline"
      job_status:
        | "intake_started"
        | "intake_completed"
        | "validation_required"
        | "ready_for_dispatch"
        | "driver_offer_sent"
        | "driver_assigned"
        | "driver_enroute"
        | "job_completed"
        | "job_amended"
        | "dispatch_recommendation_ready"
        | "driver_offer_prepared"
        | "driver_arrived"
        | "vehicle_loaded"
        | "customer_reapproval_pending"
        | "reassignment_required"
        | "driver_unavailable"
        | "cancelled_by_customer"
        | "cancelled_after_dispatch"
        | "payment_authorization_required"
        | "payment_failed"
        | "service_in_progress"
        | "payment_authorized"
      offer_status: "pending" | "accepted" | "declined" | "expired"
      truck_status: "available" | "busy" | "offline"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_event_type: [
        "job_created",
        "job_updated",
        "status_changed",
        "driver_assigned",
        "offer_sent",
        "offer_responded",
        "system_event",
        "amendment_requested",
        "reassignment_requested",
        "driver_unavailable",
        "job_cancelled",
        "customer_update",
      ],
      driver_availability: ["available", "busy", "offline"],
      job_status: [
        "intake_started",
        "intake_completed",
        "validation_required",
        "ready_for_dispatch",
        "driver_offer_sent",
        "driver_assigned",
        "driver_enroute",
        "job_completed",
        "job_amended",
        "dispatch_recommendation_ready",
        "driver_offer_prepared",
        "driver_arrived",
        "vehicle_loaded",
        "customer_reapproval_pending",
        "reassignment_required",
        "driver_unavailable",
        "cancelled_by_customer",
        "cancelled_after_dispatch",
        "payment_authorization_required",
        "payment_failed",
        "service_in_progress",
        "payment_authorized",
      ],
      offer_status: ["pending", "accepted", "declined", "expired"],
      truck_status: ["available", "busy", "offline"],
    },
  },
} as const
