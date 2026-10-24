package team.gaussx.beacon

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build

/** 화면이 꺼져도 계속 돌도록 포그라운드 서비스로 띄운다 (알림이 떠 있는 동안 동작) */
object Foreground {
    private const val CHANNEL = "gaussx-beacon"

    fun start(service: Service, id: Int, title: String, text: String, type: Int) {
        val nm = service.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "GaussX 비콘 동작", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            service, 0, Intent(service, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(service, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) service.startForeground(id, notification, type)
        else service.startForeground(id, notification)
    }
}
