#!/bin/bash
#
# Monitoring script for Node.js based services
#
# Configure, set runmonitor.sh in your crontab, forget.
#


# Override if necessary
NODE=$(which node)

# PID file
PIDFILE="pid.lietuserv"

# What script to run
SCRIPT_FILE="lietuserv.js"

# Email recipient in case a restart is needed
EMAIL_RECIPIENT="janne.enberg@lietu.net"

# Email subject
EMAIL_SUBJECT="JSIS.name ${SCRIPT_FILE} crashed on $(uname -n)"

# Error log file
ERROR_LOG="err.lietuserv"


#
# Script logic
#

start=$(date +%s)
while [ true ]; do
    ok=0

	# Check pidfile
	if [ -f "${PIDFILE}" ]; then

		# Read the PID from it
		pid=$(cat "${PIDFILE}")

		# Check if it's running
		if kill -0 2>&1 > /dev/null $pid; then
			# All OK
			ok=1
		fi
	fi

	# If not OK, then try to start
	if [ "${ok}" -eq 0 ]; then

		errorlog=$(cat "${ERROR_LOG}")

		# Start node in the background
		"${NODE}" "${SCRIPT_FILE}" 2>"${ERROR_LOG}" &

		# Catch PID
		pid=$!

		# Store in PID file
		echo $pid > "${PIDFILE}"

		# Build a notification message
		email_message="Node.js service ${SCRIPT_FILE} seems to have crashed on host. Restarting...

Uptime:
$(uptime)

Error log:
${errorlog}
"

		# Send it via email
		echo "${email_message}" | mail -s"${EMAIL_SUBJECT}" "${EMAIL_RECIPIENT}"

		# And output to terminal
		echo "${email_message}"

	fi

	# Make sure we don't run infinitely
	now=$(date +%s)
	elapsed=$(expr "${now}" - "${start}")
	if [ "${elapsed}" -gt 59 ]; then
		exit 0
	fi

	# Sleep a while to prevent eating 100% CPU
	sleep 1
done


